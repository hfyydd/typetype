---
license: apache-2.0
library_name: generic
tags: 
  - text2text-generation
  - punctuation 
  - sentence-boundary-detection
  - truecasing
language:
- af
- am
- ar
- bg
- bn
- de
- el
- en
- es
- et
- fa
- fi
- fr
- gu
- hi
- hr
- hu
- id
- is
- it
- ja
- kk
- kn
- ko
- ky
- lt
- lv
- mk
- ml
- mr
- nl
- or
- pa
- pl
- ps
- pt
- ro
- ru
- rw
- so
- sr
- sw
- ta
- te
- tr
- uk
- zh
---
# Model Overview
This model accepts as input lower-cased, unpunctuated, unsegmented text in 47 languages and performs punctuation restoration, true-casing (capitalization), and sentence boundary detection (segmentation).

All languages are processed with the same algorithm with no need for language tags or language-specific branches in the graph.
This includes continuous-script and non-continuous script languages, predicting language-specific punctuation, etc.

This model is fun to play with, but the results could be better. I would recommend these newer, better models:
 * [Better English model](https://huggingface.co/1-800-BAD-CODE/punctuation_fullstop_truecase_english)
 * [Better Romance languages model](https://huggingface.co/1-800-BAD-CODE/punctuation_fullstop_truecase_romance)
 * [Better 47-language](https://huggingface.co/1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase)
   
# Usage
The easy way to use this model is to install `punctuators`:

```bash
pip install punctuators
```

Running the following script should load this model and run some texts:
<details open>

  <summary>Example Usage</summary>

```python
from punctuators.models import PunctCapSegModelONNX

# Instantiate this model
# This will download the ONNX and SPE models. To clean up, delete this model from your HF cache directory.
m = PunctCapSegModelONNX.from_pretrained("pcs_47lang")

# Define some input texts to punctuate
input_texts: List[str] = [
    "hola mundo cómo estás estamos bajo el sol y hace mucho calor santa coloma abre los huertos urbanos a las escuelas de la ciudad",
    "hello friend how's it going it's snowing outside right now in connecticut a large storm is moving in",
    "未來疫苗將有望覆蓋3歲以上全年齡段美國與北約軍隊已全部撤離還有鐵路公路在內的各項基建的來源都將枯竭",
    "በባለፈው ሳምንት ኢትዮጵያ ከሶማሊያ 3 ሺህ ወታደሮቿንም እንዳስወጣች የሶማሊያው ዳልሳን ሬድዮ ዘግቦ ነበር ጸጥታ ሃይሉና ህዝቡ ተቀናጅቶ በመስራቱ በመዲናዋ ላይ የታቀደው የጥፋት ሴራ ከሽፏል",
    "all human beings are born free and equal in dignity and rights they are endowed with reason and conscience and should act towards one another in a spirit of brotherhood",
    "सभी मनुष्य जन्म से मर्यादा और अधिकारों में स्वतंत्र और समान होते हैं वे तर्क और विवेक से संपन्न हैं तथा उन्हें भ्रातृत्व की भावना से परस्पर के प्रति कार्य करना चाहिए",
    "wszyscy ludzie rodzą się wolni i równi pod względem swej godności i swych praw są oni obdarzeni rozumem i sumieniem i powinni postępować wobec innych w duchu braterstwa",
    "tous les êtres humains naissent libres et égaux en dignité et en droits ils sont doués de raison et de conscience et doivent agir les uns envers les autres dans un esprit de fraternité",
]
results: List[List[str]] = m.infer(input_texts)
for input_text, output_texts in zip(input_texts, results):
    print(f"Input: {input_text}")
    print(f"Outputs:")
    for text in output_texts:
        print(f"\t{text}")
    print()

```

</details>

<details open>

  <summary>Expected Output</summary>

```text
Input: hola mundo cómo estás estamos bajo el sol y hace mucho calor santa coloma abre los huertos urbanos a las escuelas de la ciudad
Outputs:
	Hola Mundo, ¿cómo estás?
	Estamos bajo el sol y hace mucho calor.
	Santa Coloma abre los huertos urbanos a las escuelas de la ciudad.

Input: hello friend how's it going it's snowing outside right now in connecticut a large storm is moving in
Outputs:
	Hello Friend, how's it going?
	It's snowing outside right now.
	In Connecticut, a large storm is moving in.

Input: 未來疫苗將有望覆蓋3歲以上全年齡段美國與北約軍隊已全部撤離還有鐵路公路在內的各項基建的來源都將枯竭
Outputs:
	未來，疫苗將有望覆蓋3歲以上全年齡段。
	美國與北約軍隊已全部撤離。
	還有鐵路公路在內的各項基建的來源都將枯竭。

Input: በባለፈው ሳምንት ኢትዮጵያ ከሶማሊያ 3 ሺህ ወታደሮቿንም እንዳስወጣች የሶማሊያው ዳልሳን ሬድዮ ዘግቦ ነበር ጸጥታ ሃይሉና ህዝቡ ተቀናጅቶ በመስራቱ በመዲናዋ ላይ የታቀደው የጥፋት ሴራ ከሽፏል
Outputs:
	በባለፈው ሳምንት ኢትዮጵያ ከሶማሊያ 3 ሺህ ወታደሮቿንም እንዳስወጣች የሶማሊያው ዳልሳን ሬድዮ ዘግቦ ነበር።
	ጸጥታ ሃይሉና ህዝቡ ተቀናጅቶ በመስራቱ በመዲናዋ ላይ የታቀደው የጥፋት ሴራ ከሽፏል።

Input: all human beings are born free and equal in dignity and rights they are endowed with reason and conscience and should act towards one another in a spirit of brotherhood
Outputs:
	All human beings are born free and equal in dignity and rights.
	They are endowed with reason and conscience and should act towards one another in a spirit of brotherhood.

Input: सभी मनुष्य जन्म से मर्यादा और अधिकारों में स्वतंत्र और समान होते हैं वे तर्क और विवेक से संपन्न हैं तथा उन्हें भ्रातृत्व की भावना से परस्पर के प्रति कार्य करना चाहिए
Outputs:
	सभी मनुष्य जन्म से मर्यादा और अधिकारों में स्वतंत्र और समान होते हैं।
	वे तर्क और विवेक से संपन्न हैं तथा उन्हें भ्रातृत्व की भावना से परस्पर के प्रति कार्य करना चाहिए।

Input: wszyscy ludzie rodzą się wolni i równi pod względem swej godności i swych praw są oni obdarzeni rozumem i sumieniem i powinni postępować wobec innych w duchu braterstwa
Outputs:
	Wszyscy ludzie rodzą się wolni i równi pod względem swej godności i swych praw.
	Są oni obdarzeni rozumem i sumieniem i powinni postępować wobec innych w duchu braterstwa.

Input: tous les êtres humains naissent libres et égaux en dignité et en droits ils sont doués de raison et de conscience et doivent agir les uns envers les autres dans un esprit de fraternité
Outputs:
	Tous les êtres humains naissent libres et égaux, en dignité et en droits.
	Ils sont doués de raison et de conscience et doivent agir les uns envers les autres.
	Dans un esprit de fraternité.

```

Note that "Mundo" and "Friend" are proper nouns in this usage, which is why the model consistently upper-cases similar tokens in multiple languages.

</details>
    
# Model Details

This model generally follows the graph shown below, with brief descriptions for each step following.

![graph.png](https://s3.amazonaws.com/moonup/production/uploads/1677025540482-62d34c813eebd640a4f97587.png)


1. **Encoding**:
The model begins by tokenizing the text with a subword tokenizer.
The tokenizer used here is a `SentencePiece` model with a vocabulary size of 64k.
Next, the input sequence is encoded with a base-sized Transformer, consisting of 6 layers with a model dimension of 512.

2. **Post-punctuation**:
The encoded sequence is then fed into a classification network to predict "post" punctuation tokens. 
Post punctuation are punctuation tokens that may appear after a word, basically most normal punctuation.
Post punctuation is predicted once per subword - further discussion is below. 

3. **Re-encoding**
All subsequent tasks (true-casing, sentence boundary detection, and "pre" punctuation) are dependent on "post" punctuation.
Therefore, we must conditional all further predictions on the post punctuation tokens.
For this task, predicted punctation tokens are fed into an embedding layer, where embeddings represent each possible punctuation token.
Each time step is mapped to a 4-dimensional embeddings, which is concatenated to the 512-dimensional encoding.
The concatenated joint representation is re-encoded to confer global context to each time step to incorporate punctuation predictions into subsequent tasks.

4. **Pre-punctuation**
After the re-encoding, another classification network predicts "pre" punctuation, or punctuation tokens that may appear before a word.
In practice, this means the inverted question mark for Spanish and Asturian, `¿`.
Note that a `¿` can only appear if a `?` is predicted, hence the conditioning.

5. **Sentence boundary detection**
Parallel to the "pre" punctuation, another classification network predicts sentence boundaries from the re-encoded text.
In all languages, sentence boundaries can occur only if a potential full stop is predicted, hence the conditioning.

6. **Shift and concat sentence boundaries**
In many languages, the first character of each sentence should be upper-cased.
Thus, we should feed the sentence boundary information to the true-case classification network.
Since the true-case classification network is feed-forward and has no context, each time step must embed whether it is the first word of a sentence.
Therefore, we shift the binary sentence boundary decisions to the right by one: if token `N-1` is a sentence boundary, token `N` is the first word of a sentence.
Concatenating this with the re-encoded text, each time step contains whether it is the first word of a sentence as predicted by the SBD head.

7. **True-case prediction**
Armed with the knowledge of punctuation and sentence boundaries, a classification network predicts true-casing.
Since true-casing should be done on a per-character basis, the classification network makes `N` predictions per token, where `N` is the length of the subtoken.
(In practice, `N` is the longest possible subword, and the extra predictions are ignored).
This scheme captures acronyms, e.g., "NATO", as well as bi-capitalized words, e.g., "MacDonald".


## Post-Punctuation Tokens
This model predicts the following set of "post" punctuation tokens after each subword:

| Token  | Description | Relevant Languages |
| ---: | :---------- | :----------- |
| .    | Latin full stop | Many |
| ,    | Latin comma | Many |
| ?    | Latin question mark | Many |
| ？    | Full-width question mark | Chinese, Japanese |
| ，    | Full-width comma | Chinese, Japanese |
| 。    | Full-width full stop | Chinese, Japanese |
| 、    | Ideographic comma | Chinese, Japanese |
| ・    | Middle dot | Japanese |
| ।    | Danda | Hindi, Bengali, Oriya |
| ؟    | Arabic question mark | Arabic |
| ;    | Greek question mark | Greek |
| ።    | Ethiopic full stop | Amharic |
| ፣    | Ethiopic comma | Amharic |
| ፧    | Ethiopic question mark | Amharic |


## Pre-Punctuation Tokens
This model predicts the following set of "pre" punctuation tokens before each subword:

| Token  | Description | Relevant Languages |
| ---: | :---------- | :----------- |
| ¿    | Inverted question mark | Spanish |



# Training Details
This model was trained in the NeMo framework.

## Training Data
This model was trained with News Crawl data from WMT.

1M lines of text for each language was used, except for a few low-resource languages which may have used less.

Languages were chosen based on whether the News Crawl corpus contained enough reliable-quality data as judged by the author.

# Limitations
This model was trained on news data, and may not perform well on conversational or informal data.

This model predicts punctuation only once per subword. 
This implies that some acronyms, e.g., 'U.S.', cannot properly be punctuated.
This concession was accepted on two grounds:
1. Such acronyms are rare, especially in the context of multi-lingual models
2. Punctuated acronyms are typically pronounced as individual characters, e.g., 'U.S.' vs. 'NATO'.
   Since the expected use-case of this model is the output of an ASR system, it is presumed that such
   pronunciations would be transcribed as separate tokens, e.g, 'u s' vs. 'us' (though this depends on the model's pre-processing).

Further, this model is unlikely to be of production quality. 
It was trained with "only" 1M lines per language, and the dev sets may have been noisy due to the nature of web-scraped news data.
This is also a base-sized model with many languages and many tasks, so capacity may be limited.

This model's maximum sequence length is 128, which is relatively short for an NLP problem.

After analyzing the limitations of this version, a future version of this model will attempt to improve the following points:
1. Longer maximum length
2. More training data
3. More training steps

# Evaluation
In these metrics, keep in mind that
1. The data is noisy
2. Sentence boundaries and true-casing are conditioned on predicted punctuation, which is the most difficult task and sometimes incorrect.
   When conditioning on reference punctuation, true-casing and SBD is practically 100% for most languages.
4. Punctuation can be subjective. E.g.,
   
   `Hola mundo, ¿cómo estás?`
   
   or

   `Hola mundo. ¿Cómo estás?`

   When the sentences are longer and more practical, these ambiguities abound and affect all 3 analytics.

## Test Data and Example Generation
Each test example was generated using the following procedure:

1. Concatenate 5 random sentences
2. Lower-case the concatenated sentence
3. Remove all punctuation

The data is a held-out portion of News Crawl, which has been deduplicated. 
2,000 lines of data per language was used, generating 2,000 unique examples of 5 sentences each.
The last 4 sentences of each example were randomly sampled from the 2,000 and may be duplicated.

Examples longer than the model's maximum length were truncated. 
The number of affected sentences can be estimated from the "full stop" support: with 2,000 sentences and 5 sentences per example, we expect 10,000 full stop targets total.

## Selected Language Evaluation Reports
This model will likely be updated soon, so only a few languages are reported below.

<details>
  <summary>English</summary>
  
  ```
punct_post test report:
    label                                                precision    recall       f1           support
    <NULL> (label_id: 0)                                    98.71      98.66      98.68     156605
    . (label_id: 1)                                         87.72      88.85      88.28       8752
    , (label_id: 2)                                         68.06      67.81      67.93       5216
    ? (label_id: 3)                                         79.38      77.20      78.27        693
    ？ (label_id: 4)                                          0.00       0.00       0.00          0
    ， (label_id: 5)                                          0.00       0.00       0.00          0
    。 (label_id: 6)                                          0.00       0.00       0.00          0
    、 (label_id: 7)                                          0.00       0.00       0.00          0
    ・ (label_id: 8)                                          0.00       0.00       0.00          0
    । (label_id: 9)                                          0.00       0.00       0.00          0
    ؟ (label_id: 10)                                         0.00       0.00       0.00          0
    ، (label_id: 11)                                         0.00       0.00       0.00          0
    ; (label_id: 12)                                         0.00       0.00       0.00          0
    ። (label_id: 13)                                         0.00       0.00       0.00          0
    ፣ (label_id: 14)                                         0.00       0.00       0.00          0
    ፧ (label_id: 15)                                         0.00       0.00       0.00          0
    -------------------
    micro avg                                               97.13      97.13      97.13     171266
    macro avg                                               83.46      83.13      83.29     171266
    weighted avg                                            97.13      97.13      97.13     171266

cap test report:
    label                                                precision    recall       f1           support
    LOWER (label_id: 0)                                     99.63      99.49      99.56     526612
    UPPER (label_id: 1)                                     89.19      91.84      90.50      24161
    -------------------
    micro avg                                               99.15      99.15      99.15     550773
    macro avg                                               94.41      95.66      95.03     550773
    weighted avg                                            99.17      99.15      99.16     550773

seg test report:
    label                                                precision    recall       f1           support
    NOSTOP (label_id: 0)                                    99.37      99.42      99.39     162044
    FULLSTOP (label_id: 1)                                  89.75      88.84      89.29       9222
    -------------------
    micro avg                                               98.85      98.85      98.85     171266
    macro avg                                               94.56      94.13      94.34     171266
    weighted avg                                            98.85      98.85      98.85     171266
  ```
</details>


<details>
  <summary>Spanish</summary>

  ```
 punct_pre test report:
    label                                                precision    recall       f1           support
    <NULL> (label_id: 0)                                    99.94      99.92      99.93     185535
    ¿ (label_id: 1)                                         55.01      64.86      59.53        296
    -------------------
    micro avg                                               99.86      99.86      99.86     185831
    macro avg                                               77.48      82.39      79.73     185831
    weighted avg                                            99.87      99.86      99.87     185831

punct_post test report:
    label                                                precision    recall       f1           support
    <NULL> (label_id: 0)                                    98.74      98.86      98.80     170282
    . (label_id: 1)                                         90.07      89.58      89.82       9959
    , (label_id: 2)                                         68.33      67.00      67.66       5300
    ? (label_id: 3)                                         70.25      58.62      63.91        290
    ？ (label_id: 4)                                          0.00       0.00       0.00          0
    ， (label_id: 5)                                          0.00       0.00       0.00          0
    。 (label_id: 6)                                          0.00       0.00       0.00          0
    、 (label_id: 7)                                          0.00       0.00       0.00          0
    ・ (label_id: 8)                                          0.00       0.00       0.00          0
    । (label_id: 9)                                          0.00       0.00       0.00          0
    ؟ (label_id: 10)                                         0.00       0.00       0.00          0
    ، (label_id: 11)                                         0.00       0.00       0.00          0
    ; (label_id: 12)                                         0.00       0.00       0.00          0
    ። (label_id: 13)                                         0.00       0.00       0.00          0
    ፣ (label_id: 14)                                         0.00       0.00       0.00          0
    ፧ (label_id: 15)                                         0.00       0.00       0.00          0
    -------------------
    micro avg                                               97.39      97.39      97.39     185831
    macro avg                                               81.84      78.51      80.05     185831
    weighted avg                                            97.36      97.39      97.37     185831

cap test report:
    label                                                precision    recall       f1           support
    LOWER (label_id: 0)                                     99.62      99.60      99.61     555041
    UPPER (label_id: 1)                                     90.60      91.06      90.83      23538
    -------------------
    micro avg                                               99.25      99.25      99.25     578579
    macro avg                                               95.11      95.33      95.22     578579
    weighted avg                                            99.25      99.25      99.25     578579

[NeMo I 2023-02-22 17:24:04 punct_cap_seg_model:427] seg test report:
    label                                                precision    recall       f1           support
    NOSTOP (label_id: 0)                                    99.44      99.54      99.49     175908
    FULLSTOP (label_id: 1)                                  91.68      89.98      90.82       9923
    -------------------
    micro avg                                               99.03      99.03      99.03     185831
    macro avg                                               95.56      94.76      95.16     185831
    weighted avg                                            99.02      99.03      99.02     185831
```
</details>

<details>
  <summary>Chinese</summary>

```
punct_post test report:
    label                                                precision    recall       f1           support
    <NULL> (label_id: 0)                                    98.82      97.34      98.07     147920
    . (label_id: 1)                                          0.00       0.00       0.00          0
    , (label_id: 2)                                          0.00       0.00       0.00          0
    ? (label_id: 3)                                          0.00       0.00       0.00          0
    ？ (label_id: 4)                                         85.77      80.71      83.16        560
    ， (label_id: 5)                                         59.88      78.02      67.75       6901
    。 (label_id: 6)                                         92.50      93.92      93.20      10988
    、 (label_id: 7)                                          0.00       0.00       0.00          0
    ・ (label_id: 8)                                          0.00       0.00       0.00          0
    । (label_id: 9)                                          0.00       0.00       0.00          0
    ؟ (label_id: 10)                                         0.00       0.00       0.00          0
    ، (label_id: 11)                                         0.00       0.00       0.00          0
    ; (label_id: 12)                                         0.00       0.00       0.00          0
    ። (label_id: 13)                                         0.00       0.00       0.00          0
    ፣ (label_id: 14)                                         0.00       0.00       0.00          0
    ፧ (label_id: 15)                                         0.00       0.00       0.00          0
    -------------------
    micro avg                                               96.25      96.25      96.25     166369
    macro avg                                               84.24      87.50      85.55     166369
    weighted avg                                            96.75      96.25      96.45     166369

cap test report:
    label                                                precision    recall       f1           support
    LOWER (label_id: 0)                                     97.07      92.39      94.67        394
    UPPER (label_id: 1)                                     70.59      86.75      77.84         83
    -------------------
    micro avg                                               91.40      91.40      91.40        477
    macro avg                                               83.83      89.57      86.25        477
    weighted avg                                            92.46      91.40      91.74        477

seg test report:
    label                                                precision    recall       f1           support
    NOSTOP (label_id: 0)                                    99.58      99.53      99.56     156369
    FULLSTOP (label_id: 1)                                  92.77      93.50      93.13      10000
    -------------------
    micro avg                                               99.17      99.17      99.17     166369
    macro avg                                               96.18      96.52      96.35     166369
    weighted avg                                            99.17      99.17      99.17     166369
```
</details>


<details>
  <summary>Hindi</summary>

```
punct_post test report:
    label                                                precision    recall       f1           support
    <NULL> (label_id: 0)                                    99.58      99.59      99.59     176743
    . (label_id: 1)                                          0.00       0.00       0.00          0
    , (label_id: 2)                                         68.32      65.23      66.74       1815
    ? (label_id: 3)                                         60.27      44.90      51.46         98
    ？ (label_id: 4)                                          0.00       0.00       0.00          0
    ， (label_id: 5)                                          0.00       0.00       0.00          0
    。 (label_id: 6)                                          0.00       0.00       0.00          0
    、 (label_id: 7)                                          0.00       0.00       0.00          0
    ・ (label_id: 8)                                          0.00       0.00       0.00          0
    । (label_id: 9)                                         96.45      97.43      96.94      10136
    ؟ (label_id: 10)                                         0.00       0.00       0.00          0
    ، (label_id: 11)                                         0.00       0.00       0.00          0
    ; (label_id: 12)                                         0.00       0.00       0.00          0
    ። (label_id: 13)                                         0.00       0.00       0.00          0
    ፣ (label_id: 14)                                         0.00       0.00       0.00          0
    ፧ (label_id: 15)                                         0.00       0.00       0.00          0
    -------------------
    micro avg                                               99.11      99.11      99.11     188792
    macro avg                                               81.16      76.79      78.68     188792
    weighted avg                                            99.10      99.11      99.10     188792

cap test report:
    label                                                precision    recall       f1           support
    LOWER (label_id: 0)                                     98.25      95.06      96.63        708
    UPPER (label_id: 1)                                     89.46      96.12      92.67        309
    -------------------
    micro avg                                               95.38      95.38      95.38       1017
    macro avg                                               93.85      95.59      94.65       1017
    weighted avg                                            95.58      95.38      95.42       1017

seg test report:
    label                                                precision    recall       f1           support
    NOSTOP (label_id: 0)                                    99.87      99.85      99.86     178892
    FULLSTOP (label_id: 1)                                  97.38      97.58      97.48       9900
    -------------------
    micro avg                                               99.74      99.74      99.74     188792
    macro avg                                               98.62      98.72      98.67     188792
    weighted avg                                            99.74      99.74      99.74     188792
```
</details>

<details>
  <summary>Amharic</summary>

```
punct_post test report:
    label                                                precision    recall       f1           support
    <NULL> (label_id: 0)                                    99.58      99.42      99.50     236298
    . (label_id: 1)                                          0.00       0.00       0.00          0
    , (label_id: 2)                                          0.00       0.00       0.00          0
    ? (label_id: 3)                                          0.00       0.00       0.00          0
    ？ (label_id: 4)                                          0.00       0.00       0.00          0
    ， (label_id: 5)                                          0.00       0.00       0.00          0
    。 (label_id: 6)                                          0.00       0.00       0.00          0
    、 (label_id: 7)                                          0.00       0.00       0.00          0
    ・ (label_id: 8)                                          0.00       0.00       0.00          0
    । (label_id: 9)                                          0.00       0.00       0.00          0
    ؟ (label_id: 10)                                         0.00       0.00       0.00          0
    ، (label_id: 11)                                         0.00       0.00       0.00          0
    ; (label_id: 12)                                         0.00       0.00       0.00          0
    ። (label_id: 13)                                        89.79      95.24      92.44       9169
    ፣ (label_id: 14)                                        66.85      56.58      61.29       1504
    ፧ (label_id: 15)                                        67.67      83.72      74.84        215
    -------------------
    micro avg                                               98.99      98.99      98.99     247186
    macro avg                                               80.97      83.74      82.02     247186
    weighted avg                                            98.99      98.99      98.98     247186

cap test report:
    label                                                precision    recall       f1           support
    LOWER (label_id: 0)                                     96.65      99.78      98.19       1360
    UPPER (label_id: 1)                                     98.90      85.13      91.50        316
    -------------------
    micro avg                                               97.02      97.02      97.02       1676
    macro avg                                               97.77      92.45      94.84       1676
    weighted avg                                            97.08      97.02      96.93       1676

seg test report:
    label                                                precision    recall       f1           support
    NOSTOP (label_id: 0)                                    99.85      99.74      99.80     239845
    FULLSTOP (label_id: 1)                                  91.72      95.25      93.45       7341
    -------------------
    micro avg                                               99.60      99.60      99.60     247186
    macro avg                                               95.79      97.49      96.62     247186
    weighted avg                                            99.61      99.60      99.61     247186
```
</details>