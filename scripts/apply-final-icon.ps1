param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePng,

  [string]$ResourcesDir = (Join-Path $PSScriptRoot "..\resources")
)

Add-Type -AssemblyName System.Drawing

function New-ResizedBitmap {
  param(
    [System.Drawing.Bitmap]$Source,
    [int]$Size
  )

  $target = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($Source, 0, 0, $Size, $Size)
  $graphics.Dispose()
  return $target
}

function Save-Png {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Get-PngBytes {
  param([System.Drawing.Bitmap]$Bitmap)

  $stream = [System.IO.MemoryStream]::new()
  $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  return $bytes
}

function Write-UInt16LE {
  param([System.IO.BinaryWriter]$Writer, [int]$Value)
  $Writer.Write([uint16]$Value)
}

function Write-UInt32LE {
  param([System.IO.BinaryWriter]$Writer, [int]$Value)
  $Writer.Write([uint32]$Value)
}

function Write-IcoFromPngs {
  param(
    [hashtable[]]$Images,
    [string]$Path
  )

  $output = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = [System.IO.BinaryWriter]::new($output)
  try {
    Write-UInt16LE $writer 0
    Write-UInt16LE $writer 1
    Write-UInt16LE $writer $Images.Count

    $offset = 6 + (16 * $Images.Count)
    foreach ($image in $Images) {
      $size = [int]$image.Size
      $bytes = [byte[]]$image.Bytes
      $encodedSize = if ($size -ge 256) { 0 } else { $size }
      $writer.Write([byte]$encodedSize)
      $writer.Write([byte]$encodedSize)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      Write-UInt16LE $writer 1
      Write-UInt16LE $writer 32
      Write-UInt32LE $writer $bytes.Length
      Write-UInt32LE $writer $offset
      $offset += $bytes.Length
    }

    foreach ($image in $Images) {
      $writer.Write([byte[]]$image.Bytes)
    }
  } finally {
    $writer.Dispose()
    $output.Dispose()
  }
}

function Fill-Generated-Corners {
  param([System.Drawing.Bitmap]$Bitmap)

  $background = [System.Drawing.Color]::FromArgb(255, 76, 90, 80)
  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      $pixel = $Bitmap.GetPixel($x, $y)
      if (($pixel.R -lt 20 -and $pixel.G -lt 20 -and $pixel.B -lt 20) -or $pixel.A -lt 8) {
        $Bitmap.SetPixel($x, $y, $background)
      }
    }
  }
}

if (-not (Test-Path -LiteralPath $SourcePng)) {
  throw "Missing source PNG: $SourcePng"
}

$source = [System.Drawing.Bitmap]::FromFile($SourcePng)
try {
  Fill-Generated-Corners $source

  New-Item -ItemType Directory -Force -Path $ResourcesDir | Out-Null

  $iconPng = Join-Path $ResourcesDir "icon.png"
  Save-Png $source $iconPng

  $sizes = @(256, 128, 64, 48, 32, 16)
  $icoImages = @()
  foreach ($size in $sizes) {
    $resized = New-ResizedBitmap $source $size
    try {
      $icoImages += @{ Size = $size; Bytes = (Get-PngBytes $resized) }
    } finally {
      $resized.Dispose()
    }
  }
  Write-IcoFromPngs $icoImages (Join-Path $ResourcesDir "icon.ico")

  foreach ($base in @("tray-icons", "tray-icons-16")) {
    $baseDir = Join-Path $ResourcesDir $base
    if (-not (Test-Path -LiteralPath $baseDir)) {
      continue
    }

    $traySize = if ($base -eq "tray-icons-16") { 16 } else { 32 }
    $trayBitmap = New-ResizedBitmap $source $traySize
    try {
      foreach ($status in @("idle", "recording", "processing")) {
        $statusDir = Join-Path $baseDir $status
        New-Item -ItemType Directory -Force -Path $statusDir | Out-Null
        for ($index = 0; $index -lt 8; $index++) {
          Save-Png $trayBitmap (Join-Path $statusDir ("frame_{0}.png" -f $index))
        }
      }
    } finally {
      $trayBitmap.Dispose()
    }
  }
} finally {
  $source.Dispose()
}

Write-Output "Applied icon assets from $SourcePng"
