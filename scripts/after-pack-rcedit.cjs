const fs = require("fs");
const path = require("path");
const { NtExecutable, NtExecutableResource, Resource, Data } = require("resedit");

module.exports = async function afterPackRcedit(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.projectDir;
  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.join(projectDir, "resources", "icon.ico");

  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) {
    return;
  }

  const version = appInfo.version || "0.1.1";
  const description = appInfo.description || appInfo.productName || "typetype";
  const productName = appInfo.productName || "typetype";
  const copyright = appInfo.copyright || "Copyright typetype";
  const [major, minor, patch, build] = parseVersion(version);

  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);
  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));

  const iconGroups = Resource.IconGroupEntry.fromEntries(res.entries);
  const iconGroup = iconGroups[0] || { id: 1, lang: 1033 };
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    iconGroup.id,
    iconGroup.lang,
    iconFile.icons.map((item) => item.data),
  );

  const versions = Resource.VersionInfo.fromEntries(res.entries);
  if (versions.length > 0) {
    const versionInfo = versions[0];
    const defaultLang = versionInfo.getDefaultVersionLang("FileDescription");
    const language =
      typeof defaultLang === "object" && defaultLang !== null
        ? defaultLang
        : { lang: defaultLang || 1033, codepage: 1200 };

    versionInfo.setFileVersion(major, minor, patch, build, language.lang);
    versionInfo.setProductVersion(major, minor, patch, build, language.lang);
    versionInfo.setStringValues(
      { lang: language.lang, codepage: language.codepage || 1200 },
      {
        FileDescription: description,
        ProductName: productName,
        LegalCopyright: copyright,
        InternalName: `${productName}.exe`,
        OriginalFilename: `${productName}.exe`,
        FileVersion: version,
        ProductVersion: version,
      },
      true,
    );
    versionInfo.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};

function parseVersion(version) {
  const parts = String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  while (parts.length < 4) {
    parts.push(0);
  }

  return parts.slice(0, 4);
}
