# Experience UI mockups

A professional, dark-theme direction for **LinguaWeave**, based on
[`ideas.md`](../ideas.md) and
[`language-learning-app-spec.md`](../language-learning-app-spec.md).
This is a design artifact, not a replacement for the current application.
Game mechanics from `games.md` are intentionally out of scope.

## Open the prototype

Open [`index.html`](index.html) directly in a browser. No build, dependencies,
account, or network connection is needed. With the repository's existing Vite
development server, navigate to `/docs/mockups/index.html`.

The prototype uses relative assets and hash navigation. For example,
`index.html#reader` opens Library's reading view directly, and
`index.html#lessons` opens the lesson collection. `index.html#games` opens
the Games section within Practice. `index.html#practice` opens the Exercises
chooser; `index.html#review` and `index.html#characters` open individual exercises.

Use the **Desktop / Mobile** controls above the app to switch between a fluid
desktop viewport and a phone viewport up to 390 by 844 pixels. The controls
resize the same iframe rather than reloading it, preserving the selected screen,
conversation and unsent drafts. On a smaller window, the phone preview
fits the available space. **Open app only** opens [`app.html`](app.html) without
the preview toolbar; it is also responsive on an actual phone.

LinguaWeave remains a **working name** while naming is explored. **Assistant**
is the navigation label for conversation, explanation, and practice help.

## At a glance

![Desktop overview: a dark workspace with a tea-house reading card and contextual practice](previews/overview-desktop.png)

| Desktop mockup | Desktop mockup | Phone mockup |
| --- | --- | --- |
| [Library](previews/library-desktop.png) | [Library: reading](previews/reader-desktop.png) | [Overview](previews/overview-mobile.png) |
| [Lessons](previews/lessons-desktop.png) | [Lesson preview](previews/lesson-detail-desktop.png) | [Lessons](previews/lessons-mobile.png) |
| [Practice](previews/practice-desktop.png) | [Assistant](previews/conversation-desktop.png) | [Library: reading](previews/reader-mobile.png) |
| [Dictionary](previews/dictionary-desktop.png) | [Practice: games](previews/games-desktop.png) | [Practice](previews/practice-mobile.png) / [Games](previews/games-mobile.png) |
| [Conversation practice recap](previews/conversation-recap-desktop.png) | [Device preview](previews/device-preview.png) | [Assistant thread](previews/assistant-mobile.png) / [Conversation list](previews/conversation-list-mobile.png) |
| [Voice mode](previews/voice-mode-desktop.png) | | [Voice mode](previews/voice-mode-mobile.png) / [Composer controls](previews/assistant-controls-mobile.png) |
| [Review exercise](previews/review-desktop.png) | [Characters exercise](previews/characters-desktop.png) | [Review](previews/review-mobile.png) / [Characters](previews/characters-mobile.png) |
| [Shadow mode](previews/shadow-desktop.png) | [Shadow with Voice mode](previews/shadow-voice-desktop.png) | [Shadow](previews/shadow-mobile.png) / [Repeat after me](previews/shadow-repeat-mobile.png) |
| [New conversation](previews/new-conversation-desktop.png) | | [New conversation](previews/new-conversation-mobile.png) |

These are static captures of the same HTML prototype, not separate designs.
Phone captures show a single viewport, including the fixed bottom navigation;
scroll in the interactive prototype to explore the rest of each screen.

## Screens and interactions

| Screen | Experience | Try it |
| --- | --- | --- |
| Overview | A reading-first home with a resume point, review queue, and alternate experiences | Continue the story, start practice, or choose an experience |
| Library | Browse content and read it in one experience | Search, filter topics, preview or paste a text; open the tea-house story, change reading modes, inspect vocabulary, and return to the collection |
| Lessons | Guided units introduce vocabulary and grammar together | Choose a sample lesson, explore its words and pattern, open related reading, or discuss it with the matching Assistant conversation |
| Practice | Exercises and Games share one practice space | Choose Review or Characters under Exercises, or switch to the Games placeholder |
| Assistant | A learning partner with multiple continuing conversations | Switch between Conversation and Shadow; repeat or explain a reflected phrase; adjust speech speed and romanization; dictate a reply or explore Voice mode |
| Dictionary | Shared vocabulary rather than separate activity-specific collections | Search, filter learning state, and return to a word's reading context |

## Visual direction

- Graphite and deep green surfaces, quiet borders, warm off-white text, and
  restrained citron accents. Lavender and sand distinguish secondary experiences.
- A compact workspace shell with a stable navigation hierarchy. On narrower
  screens the sidebar becomes an icon rail, then a horizontally scrollable,
  labeled bottom navigation bar. It stays within thumb reach while content
  scrolls, with reserved space and safe-area padding for the home indicator.
- System sans-serif typography for controls; editorial serif typography for
  reading and featured content. Native script stays prominent, with romanization
  available where it helps.
- A spacious reader with a contextual learning panel rather than a dashboard
  competing with the text. On phones, the panel follows the passage; selecting a
  word moves focus to its details.
- Original vector illustration and CSS cover artwork, with no remote fonts,
  images, scripts, or media dependencies.
- Visible keyboard focus, a skip link, native dialogs, labeled controls,
  announced feedback, and reduced-motion support.

## Library and Lessons

**Library owns reading.** There is no separate Reader navigation item. Opening
a story keeps Library selected in desktop and mobile navigation, with a
Library / Reading breadcrumb and a **Back to Library** link. Returning preserves
the collection, search, and topic filters. Existing `#reader` links remain valid
for resume links and reading context from Dictionary, Practice, and Lessons.

**Lessons** is a separate top-level destination for guided vocabulary and grammar
units, rather than recall practice. Three authored previews cover simple requests,
tomorrow's plans, and asking for locations. Each provides a learning objective,
an example with romanization and meaning, vocabulary, a reusable pattern, and a
link to the matching Assistant conversation. The request lesson also links to
its companion Library story.

Lessons are freely selectable. This design does not decide prerequisites or a
fixed course sequence, generate lessons, or record completion/mastery. **Practice**
remains the separate place to revisit material through exercises and future games.

## Practice and Games

**Practice contains Exercises and Games.** Exercises opens a chooser, not a
review session. **Review** and **Characters** are individual exercise types;
both keep Exercises selected and offer an **All exercises** link.

**Review** retains contextual recall, hints, and the three-question summary.
The Overview quick-review and Dictionary review links open it directly.
Switching exercises or visiting Games preserves the question, answer, hints,
and results without restarting the review.

**Characters** is for writing individual characters, not composing sentences.
Choose a sample character (tea, rain, or cup), draw with a finger, pen, or mouse,
toggle the visual guide, undo a stroke, or clear the drawing. A keyboard
alternative lets users type the character. Each character's drawing and typed
response survive navigation and device resizing in this page, but reset on
reload. The guide is a reference glyph, not stroke-order instruction; there is
no handwriting recognition, evaluation, or mastery score.

The existing `#games` link and Overview's play shortcut open the Games section.
**Explore exercises** returns to the exercise chooser.

Games remain a visual placeholder only. This change does not introduce game
types, mechanics, scoring, or progression from `games.md`.

## Assistant conversations

A **conversation** is one continuing thread around a topic or goal, with its
own transcript and unsent draft. Open it and keep talking: there is no separate
start, end, or session-management step. Earlier messages remain in the same
scrollable transcript. The initial examples cover reading assistance,
free conversation, grammar explanations, and everyday roleplay.

**New conversation** opens a fresh chat immediately and focuses the message
input. There is no topic or style dialog to complete first. It starts as
**New conversation**, then takes a short excerpt of the first user turn as its
title; this is a local text preview, not AI-generated naming. Unsent drafts do
not set the title, and later messages do not rename the conversation.
New chats start in Conversation mode; Shadow can be applied at any time.

On desktop, entering Assistant **replaces the workspace sidebar** with a searchable
list of conversations and a **New conversation** button. It does not add a second sidebar.
**Back to workspace** restores the standard navigation and returns to the last
workspace screen, or Overview when Assistant was opened directly.

On mobile, the **same bottom navigation stays visible on every screen**, including
Assistant. Tapping Assistant shows the conversation list in the main page.
Selecting a conversation opens its transcript; the **All conversations** back arrow returns to
the list within the page. Tapping the Assistant tab again also returns to the
list. There is no mobile workspace/Assistant toolbar swap.

The picker moves between the desktop sidebar and mobile main page without
duplicating its state. Resizing an open chat preserves the selected conversation
and draft. Content and notices sit above the navigation and device safe area.
The external Desktop / Mobile preview controls remain above the prototype;
they are not part of the app navigation.

Drafts stay separate when switching conversations. Switching away during a
simulated voice recording stops that turn into a reviewable draft in its
original conversation. The demo still does not access a microphone or persist
anything across reloads.

The message input, dictation, and Voice mode controls are **docked to the bottom
of the Assistant viewport**, above the bottom navigation on mobile. They are
visible as soon as a conversation opens, without scrolling the page. History,
sample voice replies, and expanded practice recaps scroll independently above
the dock. On short viewports, the conversation header joins that scroll area
to keep the input and active voice controls available. The layout follows the
visual viewport when the mobile keyboard changes the available space.

Visible **icon controls** above the transcript select Mandarin speech speed
(0.5x, 0.75x, 1x, or 1.25x) and toggle romanization. Speech speed applies only to
the target language; English stays at normal speed. Romanization changes the
transcript, Shadow practice prompts, practice recap, and Voice mode captions consistently.

### Conversation and Shadow modes

The **Conversation / Shadow** selector changes behavior for the next turn in
the current conversation. Each thread keeps its own mode. Switching adds a
small marker to the transcript without rewriting earlier messages, clearing
the draft, or starting a new conversation. The picker identifies Shadow threads
and can find them by searching for "shadow."

Shadow reflects a supported sample utterance in Mandarin, with optional
romanization, its English meaning, and a short explanation. **Repeat after me**
sets the next input's intent to repetition and shows a model phrase in the
scrollable history. **Explain more** adds an authored explanation for that
specific phrase, without sending or replacing an unsent draft. **Say something
else**, or **New phrase** in the composer, returns to shadowing a new utterance.
After submitting a repetition, the next input returns to new-phrase shadowing.
The composer identifies whether the next turn is a new phrase or a repetition.

**Samples** offers three authored utterances about tea, tomorrow's plans, and
the station. Selecting one fills an empty draft; Send remains explicit.
Unrecognized text stays in the transcript with an explanation of the demo's
limits rather than receiving an unrelated "translation." Use the follow-up
actions for repetition and explanation; this prototype does not interpret
arbitrary spoken commands or grade pronunciation.

Shadow is independent of **Voice mode**. Switching behavior does not stop an
active or paused Voice mode preview. A sample response already on screen keeps
its original behavior; the new mode applies to the next preview turn.
Shadow voice captions offer the same follow-up actions. Dictation still needs
review and Send; its sample transcript is chosen when recording starts, so
changing mode mid-recording cannot rewrite the simulated utterance.

**Implementation direction, not a connected service:** the mockup stores
`mode` and `shadowIntent` on the conversation and tags new turns with their
mode and intent. Mode markers are UI events, not historical system messages.
A future request builder should combine common Assistant instructions with
the selected mode's instruction template and the explicit turn intent.
Request-based APIs can receive those instructions on the next request;
persistent/realtime providers need their supported update mechanism or a
replacement model session that retains context. No provider-specific system
instruction updates, AI calls, audio, or microphone access are implemented here.

Two **icon-only controls sit beside the text box**, inside the docked input:
the microphone for dictation, and a shared Voice mode / Send action. With an
empty or whitespace-only draft, the shared action shows a waveform. Entering
text changes that same button into an upward Send arrow; clearing or sending
the draft restores the waveform. Tooltips and accessible names follow the action,
and both icons retain 44-pixel touch targets.

The composer separates **dictation** (record a sample turn, review the text,
then send) from **Voice mode** (hands-free conversation).
Voice mode toggles a compact **inline panel in the
composer**, with turn status, pause/resume, and an end button. Sample replies
appear in the scrollable history rather than expanding the dock.
There is no dialog, overlay, or focus trap: the transcript, text input,
navigation, and speech/romanization controls remain available in place.
Toggle Voice mode again or use **End voice mode** to stop. Leaving the
conversation also ends it; resizing the preview preserves it. The intended connected
experience would listen and reply without pressing Send each turn; this mockup
uses explicit preview steps, never accesses a microphone or plays audio, and
does not add messages or change a typed draft through preview steps. Explicit
Shadow explanation actions do add the requested explanation to the transcript.

**What you've practiced** is an optional recap for the whole conversation:
vocabulary encountered, reusable patterns, and something to try next. Sample
recaps are authored examples, not automatic mastery judgments. New conversations
count actual demo replies but do not fabricate extracted vocabulary.

Advanced learning logs and AI request/context history remain out of scope.

## Relationship to the experience documents

| Source | Mockup decision |
| --- | --- |
| App specification: core workflow and sample content | Resume meaningful reading; support pasted text alongside sample discovery; retain source attribution |
| App specification: reading modes and mixed-language reading | Separate Source first, Mixed language, Tap to translate, and Target first modes on the same passage |
| Ideas: curriculum organized into lessons; app specification: vocabulary and phrase teaching | A Lessons destination with authored units combining vocabulary, grammar, examples, and related conversation or reading |
| Navigation feedback | Reading is a detail view within Library, not a separate top-level destination |
| App specification: session configuration | Separate weave density from the percentage of sentences actively taught; show a vocabulary-priority selector |
| App specification: learning states and spaced repetition | Show contextual review, distinguish hints from unaided recall, and keep word state visible |
| Ideas: conversation / voice mode | Visible target-speech and romanization controls; separate dictation and hands-free Voice mode entry points |
| Conversation design feedback | Continuous transcripts and optional practice recaps; a contextual desktop sidebar, or a mobile main-page picker above the unchanged bottom navigation |
| Shadow mode feedback | Per-conversation behavior changes with explicit shadow, repeat, and explain intents, separate from voice input/output |
| Ideas: activities; exercise design feedback | Exercises offers Review and Characters, separating recall from individual character writing |
| User direction: merge Games into Practice | Exercises and Games share Practice, without importing game details |

## Deliberate boundaries and open decisions

All text, metrics, progress, and tutor replies are **sample data**. The language
profile is a fixed English-to-Mandarin example; language switching is not
implemented. The three sample stories and artwork are original to this mockup.
The tea house reader shows one passage of an illustrative five-passage story,
not a complete book.

Navigation, search, filters, reading modes, word inspection, dictionary changes,
review feedback, character drawing, conversations, contextual navigation, dialogs, device preview,
and dictation / Voice mode **simulations** are interactive. Changes
exist in memory and disappear on reload. The mockup does not read or write
application storage, make network requests, access a microphone, play audio,
translate pasted content, or run an AI service. Treat pasted text as a source
preview, not a completed import. Avoid entering sensitive text.

The three-question practice queue and Overview metrics stay fixed. Adding a word
updates the sample Dictionary, not that demonstration queue. Study percentage,
study priorities, and tutor preferences explore control placement; they do not
generate lessons or run speech services. Weave density swaps a fixed sample
sequence, not a production familiarity or alignment algorithm. Target-first
reading removes visual word hints while keeping the same sample words selectable.

The experience specification uses **Unseen / Introduced / Practicing / Learned /
Mastered**; the existing normative `specs/app.md` uses **Learning / Familiar /
Mastered** for tracked items. This concept uses the former terminology without
changing production contracts. Harmonizing that vocabulary is a follow-up design
decision, not a migration implied by these mockups.

Wikipedia, Gutenberg, document import, content analysis, recording playback,
real hands-free operation, adaptive scheduling, and full history inspection
remain outside this prototype. Video learning and scanned / generated lessons
are future experiences in the source document and are not expanded in this pass.
The screens are exploratory, not an assertion that every illustrated feature is
already available.
