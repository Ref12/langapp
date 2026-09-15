# Overview
This document describes ideas for implementing various features of language learning app. Anywhere where specific languages are mentioned (English = source language). Other languages (such as Chinese/Japanese/Korean/Spanish) can mean any target language. When referring to specific romanization forms like pinyin (that should be taken to generally refer to romanization and only where it applies)


## Declarative exercise contract draft

The discussion-derived [TypeScript contracts](exercise-contracts.ts) and
[authored examples](exercise-examples.ts) explore a declarative alternative to
the exercise operation sketches below. TypeScript is the intended source of
truth for generated Zod validators; assistant output remains JSON.

The equivalent [JSON examples](exercise-examples.json) contain the exercise
samples, lesson, quiz, and app-recorded Check result, with literal Chinese text.
The top-level object groups examples for reference; it is not an assistant
response envelope. The Check result is app-owned, not assistant-authored.

Sentence building is a translation response mode, not a separate exercise type.
It uses a single source and string tiles with accepted text sequences. Repeated
tiles with the same text are interchangeable, but each occurrence is consumed
separately; unused tiles are distractors.

Lessons contain ordered teaching steps and exercises. Quizzes reuse the exercise
types for unaided knowledge checks, with feedback afterward. Character writing
supports tracing -> guided writing -> recall, or a recall-first Check with
optional teaching fallback. Needing help fails the Check permanently for that
attempt; successful post-teaching recall is a separate practice result.

Handwriting targets specify the character and locale. The app looks up the
character's associated stroke data in the system; no stroke paths or reference
IDs are supplied in the exercise. Raw learner stroke capture is also internal
to the handwriting implementation, outside these sample contracts.

These are standalone design samples, not implemented APIs. Schema generation,
renderers, assessment adapters, and persistence integration are not wired up.

# Data Representation
Curriculum in each language consists of vocabulary, grammar, and lessons. Vocabulary is a list of words or terms (can be multiword) which user should know for a given level. It should include meanings in English. Examples may or may not be present. The idea is to have a compact representation of a term. Basically word (+ disambiguator). Grammar includes semantic patterns/grammatical constructs which the user should familiarize themselves with at a certain level. It should also have a compact represent pattern (+ disambiguator/mini description). The full curriculum is passed to AI when attempting to add a new construct. The AI should be able to tell if it is a duplicate of an existing construct and return the existing if so. Lessons organize vocabulary/grammar into discreet units. Perhaps lessons should have dependencies. 
- ? Should lessons have a predefined order instead of allowing users to choose there path as long as dependencies are satisfied
- There definitely need to be a free learning mode which is user directed with the assistance of AI.

# Conversation / Voice Mode
In this mode, you have a conversation with a learning aware listening/speaking AI agent. The whole conversation should be recorded as a transcript. You can ask the agent to test you on things. You can ask it to explain things to you. You can ask the agent to say a phrase in the target language which you can then repeat. It should also allow you to vocally control the speed of agent dialogue by telling it to speed up or slow down.

## Operations
 - say(statement: string) - used to speak to the user
 - write(markdown: string) - used to write markdown response into transcript

### Visual
AI operators with visual components (i.e. not compatible with handsfree mode)
- exercises.match(pairs: Pair[]) - match word pairs
- exercises.translate(pair: Pair) - ask user to translate a word/phrase/sentence
- exercises.listen(target_language_message: string) - listen 
- exercises.sentence_builder(source: string, answer_parts: string[], extra_parts?: string[]) - run duo lingo style sentence builder exercise
- exercises.roleplay(message: string, expected_response: string, speech: bool, unexpected_responses: string[] /* wrong responses that show up in multiple choice */)

### Handsfree

- Have rules controlling AI responses (this should be verified by another agent potentially)
    - rules.add(prompt: text): id:string
    - rules.list()
    - rules.remove(id: string)

- feedback.increase_score(statement_id: string, kind: KnowledgeKind) - increases score indicating knownledge of statement in given area
- feedback.decrease_score(statement_id: string, kind: KnowledgeKind) - decreases score indicating knownledge of statement in given area

- exercises.listen(target_language_message: string) : AnnotatedAudio - reads out the message and asks the user to state which terms they heard
- exercises.translate(pair: Pair) - asks the user to translate to/from target language
- exercises.repeat_after_me(target_language_message: string) - generates an exercise to have user repeat the given message.
- knowledge.get() : Statement[] 
- lessons.list(start?: string, end?: string) - gets the lessons from the given time range

- exercises.quiz(questions: Question[]) : Quiz

- learning.log(statements: StatementId[]) - adds a list of newly learned statements

- statement.get_or_create(statement: Statement)

- lessons.search(query: string) - search for lessons by query string
- lessons.get(id: string) - get a lesson by id
- lessons.create(id: string, title: string, description: string, statements: Statement[], phrases: string[])
- lessons.update(id: string, add_statements?: Statement[], remove_statements: string[])

### Data Types

enum KnowledgeKind { Hearing, Speaking, Writing, Reading }

Question = MultipleChoiceQuestion | ShortAnswerQuestion

MultipleChoiceQuestion(question: string, answers: string[])

ShortAnswerQuestion(question: string, string: answer)

Pair(Source: string, Target: string)

Statement(value: string, disambiguators?: string[], description?: string, examples?: string[])
- Value - the word/character
- Disambiguators - English synonyms/meanings which clarify the meaning. This is useful when Value can mean different things


# Exercises
Transcription - the goal here is that the user must transcribe what the AI is saying. Modes could include a simplified one where you have to transcribe to romanization with/without tonal markers. It could also require you to select the chinese/foreign character. There could even be a mode where you have to draw the character. The goal is ear training combined with writing practice.


Translation Transcription - This is similar to transcription except you have to 


# Activities

## Match meanings
This is similar to Duolingo matching exercise. There would be say 5 cards on each side. You need to match source language/picture to target language (character/romanization/sound).

1. There's also a variant where you match sounds to characters. Perhaps you could have three rows as well, where you have to match sounds to characters then to meanings.
2. Another is a mode where you don't get immediate feedback. Not sure if I like this, but I'm trying to reduce using process of elimination to pass stages.

## Fill In The Blank
This exercise involves filling in blank in a sentence a target language sentence. Perhaps the English equivalent is given as well. 
- One mode is you chose from a set of target language words
- Another mode is you must type in the valid word. In this case, the English version must be provided.

### Sentence/Phrase builder
This exercise involves constructing the sentence or phrases from it's parts based on translating the English equivalent. You can also do the reverse where you translate from the target language to English.
- One mode is you chose from a set of target language words. (Optionally, with words there which are not valid)
- Another mode is you type in the sentence/phrase.`