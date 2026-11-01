# Flow Reminder — skill Alexa per ThoughtFlow

Skill personale: «Alexa, chiedi a Flow Reminder di ricordare che devo pulire la cucina oggi» → il pensiero arriva nell'app
Android ThoughtFlow, con l'ora in cui l'hai detto. Lì l'AI decide se è una task o un'idea e l'app pensa ai reminder.
Su Alexa non viene creato niente (né reminder né liste).

*Personal Alexa skill: "Alexa, ask Flow Reminder to remember to clean the kitchen today" sends the thought to the ThoughtFlow
Android app, with the time you said it.*

## Come funziona
1. Alexa trascrive la frase e la manda alla skill (ospitata gratis da Amazon, "Alexa-hosted").
2. La skill controlla che sia la voce del proprietario (ID vocale), cifra il testo con AES-256-GCM e lo mette in una
   cassetta su [ntfy.sh](https://ntfy.sh) (open source). ntfy vede solo testo illeggibile.
3. Una copia cifrata resta 7 giorni nel database della skill e viene rimandata se serve (ntfy tiene i messaggi 12 ore).
4. L'app ThoughtFlow ritira i messaggi (ogni 15 minuti e quando la apri), li decifra e li tratta come un pensiero scritto.

Il codice di collegamento (cassetta + chiave) si genera nell'app e si incolla **solo** in `lambda/config.js` nella console
Alexa. In questo repository non c'è nessun segreto.

## Frasi
- «Alexa, chiedi a Flow Reminder di ricordare che …» / «… di ricordarmi di …» / «… di segnare …»
- «Alexa, apri Flow Reminder» → «Cosa vuoi che ti ricordi?»
- «Alexa, chiedi a Flow Reminder di riconoscere la mia voce» (una volta)
- *English: "Alexa, ask Flow Reminder to remember …", "Alexa, open Flow Reminder", "Alexa, ask Flow Reminder to recognise my voice".*

## Struttura
- `lambda/` — codice Node.js (`index.js`, `crypto.js`, `outbox.js`, `texts.js`, `config.js`)
- `skill-package/` — manifest e modelli di interazione (it-IT, en-GB, en-US)
- `test/test.js` — prove con richieste Alexa simulate (`NODE_PATH=<ask-sdk-core> node test/test.js`)

## Privacy
- La skill riceve da Alexa il testo trascritto, l'ora della richiesta, il fuso orario dell'Echo e un identificativo anonimo
  della voce (personId), che usa solo per accettare i pensieri del proprietario.
- Il testo viene cifrato prima di uscire dalla skill; solo l'app del proprietario ha la chiave.
- Nel database della skill restano solo messaggi cifrati (massimo 7 giorni) e l'identificativo anonimo della voce.
- Niente pubblicità, statistiche o tracciamento. Nessun dato viene venduto o condiviso.
- *Privacy (EN): the skill receives the transcribed text, request time, Echo time zone and an anonymous voice id
  (personId), used only to accept the owner's thoughts. Text is encrypted before leaving the skill; only the owner's app
  has the key. The skill database keeps only encrypted messages (max 7 days) and the anonymous voice id. No ads,
  analytics or tracking.*

Licenza: Apache 2.0. Dipendenze: ASK SDK per Node.js (Apache 2.0), AWS SDK (Apache 2.0).
