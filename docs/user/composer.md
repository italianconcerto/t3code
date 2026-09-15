# Messages and context

Give the agent a task in the composer. Add files, quote a previous response, or
include a skill when the task needs more context.

Messages can contain up to 120,000 characters. Longer drafts stay in the composer
so you can shorten them or split them into several messages.

## Ask a side question with /btw

Send `/btw your question` to open an independent side discussion using a snapshot
of the current conversation and its selected model and subscription. The main
agent keeps working; side messages are not sent back to it. Goal and loop state
are not inherited. The side discussion requests plan mode and approval-required
permissions; these are provider controls, not a separate filesystem sandbox.

Use the side composer for follow-up questions. Stop affects only that side chat.
Close and discard deletes the side conversation, without restoring files. If you
navigate away or reload, `/btw` reopens the existing discussion. Open its full chat
if the provider requests an approval or clarification. Both client and server must
support side discussions. On phones, the side discussion opens as a sheet.

## Attach files

Attach up to eight files per message. Images can be up to 10 MB; other files can
be up to 50 MB, subject to the environment's upload support and limit. The agent
receives them on the environment's machine.

Uploads begin when you add an attachment. All uploads must finish before the
message can send. Retry or remove a failed upload. On web and desktop, reloading
before an upload finishes requires you to attach that file again.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the iOS photo library;
the image limit applies after conversion. On mobile, you can also send files to
T3 Code through another app's system share sheet.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments, so you can preview them and queue
messages while disconnected. Uploads resume when you reconnect. Drafts and queued
messages survive app restarts. Signing out of T3 Connect keeps that work on your
device until you sign back into the same account.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers your provider, model, and model options for new threads. A
project's configured model takes precedence; resetting that project setting
returns to the remembered selection.

Leaving reasoning level or service tier unset uses the provider's own configuration.

## Quote an assistant response

On web and desktop, select text within one assistant response and choose
**Cite in composer**. You can add a comment about the quote and write instructions
around it.

Select the quote in a draft or sent message to return to its source. If the source
is unavailable or has changed, the saved quote remains readable.

Mobile displays saved quotes and comments, but does not create citations or
navigate to their sources.

## Edit and restart from a sent message

Choose the pencil on one of your sent messages, change the text, then save.
T3 continues from that point within the same conversation. Use **See versions**
under the message to switch between the original continuation and edited versions.
Each version keeps its messages and attachments; the conversation occupies one
entry in the conversation list. Stop any active generation before editing.

This does not restore workspace files or undo work already performed. The new
agent uses the workspace as it is now, in a fresh provider session. Long histories
remain visible in the chat; the context sent to the model may be shortened.

Available on web, desktop, and mobile when the connected server supports message
versions. Assistant messages cannot be edited.

## Recall a sent prompt

Press `ArrowUp` in an empty composer to bring back the last prompt you sent in this thread. Press
`ArrowUp` again to go further back, and `ArrowDown` to come forward. Moving forward past the newest
prompt clears the composer. Recall walks the prompts loaded in the thread. Attachments, terminal
context, and other extras from the original message are not restored, only the text you typed. A
composer that holds an attachment or a picked element does not count as empty.

When the composer has text, the arrow keys move the caret as usual. Recall takes over only while
the text is an unedited recalled prompt, with the caret on the first visual line for `ArrowUp` or
the last visual line for `ArrowDown`, counting wrapped lines. Editing a recalled prompt turns it
into a normal draft.

## Prompt stash

On web and desktop, press `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux to save
the current prompt and its attachments for later. Wait for uploads to finish first.
With an empty composer, the same shortcut restores a single stash or opens the
stash menu when there are several.

Stashes containing uploaded files must be restored in their original environment.
Those files are retained for 24 hours. After an upload expires, restore the prompt
and use **Attach again** or remove the missing file before sending.

## Voice input on iPhone

On supported iPhones with iOS 26 or later, use the composer's microphone to record,
then confirm to transcribe. Text is inserted where your selection was when
recording started, ready for you to review and edit before sending.

The first use may download Apple's speech model and needs a network connection.
Later transcription works offline for that language. Recordings can be up to five
minutes long. Canceling, leaving the screen, or an audio interruption discards the
recording and preserves your existing draft.

Transcription runs on your device. T3 Code deletes the temporary audio after
transcription or cancellation; only the message text is sent when you submit.

## Commands and skills

Type `/` for commands or `$` to add a skill from the selected environment and
provider. On mobile, both are also available before starting a thread on
**New task**.

The slash menu also includes skills unless you turn off **Settings → General →
Show skills in slash menu**. Only skills enabled for the provider are listed.

Provider commands must start the message to run. T3 Code commands such as
`/model` and `/plan`, and skill mentions, work on any line.

Send `/compact` in an existing conversation to reduce context usage when the
provider supports it. Web and desktop also offer compaction from the context meter.

### Goals and recurring prompts

Send `/goal Finish the migration` to start a persistent goal managed by T3 Code.
T3 includes the objective in subsequent turns and continues automatically until
the agent confirms completion, work is paused or blocked, or a usage or budget
limit is reached. The agent must have access to T3's goal tools to confirm
completion. A normal final response does not complete the goal. Blocker reports
must describe the same obstacle on three consecutive turns; repeated calls in
one turn count only once. Provider failures can also stop continuation.

Use `/goal --budget 50000 Finish the migration` to set a token budget. T3 counts
the usage reported by the provider and checks the budget after each turn, so a
turn can exceed the remaining budget. Providers without usage reporting cannot
enforce a precise token budget. Goals survive server restarts.
`/goal` or `/goal status` shows progress; `/goal pause`, `/goal resume`, and
`/goal clear` manage the goal. Clearing a goal removes the objective, not the
conversation. Resuming a blocked goal starts a fresh blocker audit.
The thread's Stop action interrupts generation and pauses automatic continuation,
without clearing the goal. Sending your next message resumes the same goal; you
can also use `/goal resume` explicitly.
Goals wait while background agents or monitors are active, instead of repeatedly
starting turns that can only wait. Monitor completion does not resume a paused goal.

Send `/loop 5m Check the build and report failures` to repeat a prompt in this
thread. Omit the interval for a ten-minute interval. Units are `s`, `m`, `h`, and
`d`; intervals range from one second to three days. The first run starts after
one interval. Sending another `/loop` prompt replaces this thread's schedule.
`/loop` or `/loop status` shows the schedule; `/loop stop` cancels future runs.
The thread's Stop action cancels future runs and interrupts current work.

Loops run on the connected environment's server, even if you close the client.
They expire after three days and survive server restarts. Busy
threads, pending approvals, and unanswered questions delay runs without building
a backlog. Archiving or settling a thread cancels its loop. Runs use the thread's
current model and permission mode. At most 50 threads can have an active loop.
Send these commands without attachments.

### Managed subagents

Ask your agent to create a T3-managed subagent for a separate task. Each child has
its own durable chat and can use a different configured provider, subscription,
and model. Give it the context it needs; it does not share the parent's provider
session.

On web and desktop, open the Agents panel and select a managed child to read its
messages, send new instructions, or stop it. Sending instructions to an idle or
stopped child resumes work in that chat. Open its full chat for approvals, file
changes, and model selection. On mobile, open Subagents from the parent chat and
select the child; Parent chat returns to the parent.

Subagents created natively by a provider are separate from T3-managed children
and do not automatically gain these controls. Child chats share the project's
checkout unless you place the work in separate projects or worktrees.

## Images and videos in messages

Select an image or video attachment or link to preview it. Playback support depends
on your browser or device; save an unsupported video to open it in another app.

On web and desktop, right-click media to save it or copy its path or URL. On mobile,
touch and hold an image or video thumbnail and choose **Save or share**. On iOS,
return to the thumbnail to open this menu after watching a full-screen video.

File links refer to the environment's machine, including when you connect remotely.
Previews use the original file, even outside the workspace. Moving or deleting it
can break the preview, so save a copy if you need to keep it.

## Files outside the workspace

Follow an agent's file link to read a report or other file outside the workspace.
These files open read-only. An HTML file outside the workspace cannot load scripts,
styles, or images from neighboring files.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens the system chooser.
