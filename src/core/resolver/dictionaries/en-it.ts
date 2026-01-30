/**
 * Italian ↔ English Stem Translations
 *
 * Mappings between Italian and English word STEMS (not full words).
 * Use stemmer to normalize words before lookup.
 *
 * Benefits:
 * - One entry covers all morphological variants
 * - "utente", "utenti" all stem to "utent" → maps to "user"
 * - "users", "user" all stem to "user" → maps to "utent"
 *
 * Stems were generated using Snowball stemmer for each language.
 */

export const stemTranslations: [string, string][] = [
  // === Azioni / Actions ===
  // Italian stems (from Snowball Italian) → English stems (from Snowball English)
  ['acquist', 'purchas'],      // acquistare, acquista, acquisto, acquisti → purchase
  ['compr', 'buy'],            // comprare, compra → buy
  ['cre', 'creat'],            // creare → create
  ['aggiung', 'add'],          // aggiungere → add
  ['inser', 'insert'],         // inserire → insert
  ['modific', 'edit'],         // modificare → edit
  ['cambi', 'chang'],          // cambiare → change
  ['aggiorn', 'updat'],        // aggiornare → update
  ['elimin', 'delet'],         // eliminare → delete
  ['rimuov', 'remov'],         // rimuovere → remove
  ['cancell', 'cancel'],       // cancellare → cancel
  ['cerc', 'search'],          // cercare → search
  ['trov', 'find'],            // trovare → find
  ['invi', 'send'],            // inviare → send
  ['mand', 'dispatch'],        // mandare → dispatch
  ['salv', 'save'],            // salvare → save
  ['memorizz', 'stor'],        // memorizzare → store
  ['mostr', 'show'],           // mostrare → show
  ['visualizz', 'display'],    // visualizzare → display
  ['nascond', 'hide'],         // nascondere → hide
  ['abilit', 'enabl'],         // abilitare → enable
  ['attiv', 'activ'],          // attivare → activate
  ['disabilit', 'disabl'],     // disabilitare → disable
  ['disattiv', 'deactiv'],     // disattivare → deactivate
  ['inizi', 'start'],          // iniziare → start
  ['cominc', 'begin'],         // cominciare → begin
  ['ferm', 'stop'],            // fermare → stop
  ['termin', 'end'],           // terminare → end
  ['caric', 'upload'],         // caricare → upload
  ['scaric', 'download'],      // scaricare → download
  ['import', 'import'],        // importare → import
  ['esport', 'export'],        // esportare → export
  ['valid', 'valid'],          // validare → validate
  ['verific', 'verifi'],       // verificare → verify
  ['controll', 'check'],       // controllare → check
  ['approv', 'approv'],        // approvare → approve
  ['conferm', 'confirm'],      // confermare → confirm
  ['rifiut', 'reject'],        // rifiutare → reject
  ['annull', 'abort'],         // annullare → abort
  ['pag', 'pay'],              // pagare, paga, pago → pay

  // === Autenticazione / Auth ===
  ['access', 'login'],         // accesso → login
  ['acced', 'signin'],         // accedere → signin
  ['uscit', 'logout'],         // uscita → logout
  ['disconness', 'signout'],   // disconnessione → signout
  ['registr', 'regist'],       // registrazione → register
  ['iscriz', 'signup'],        // iscrizione → signup
  ['password', 'password'],
  ['session', 'session'],      // sessione → session
  ['permess', 'permiss'],      // permesso → permission
  ['autorizz', 'author'],      // autorizzazione → authorization
  ['ruol', 'role'],            // ruolo → role
  ['grupp', 'group'],          // gruppo → group

  // === Entità / Entities ===
  ['utent', 'user'],           // utente, utenti → user, users
  ['client', 'custom'],        // cliente, clienti → customer, customers
  ['account', 'account'],
  ['membr', 'member'],         // membro → member
  ['amministr', 'admin'],      // amministratore → admin
  ['pagament', 'payment'],     // pagamento → payment
  ['transaz', 'transact'],     // transazione → transaction
  ['addebit', 'charg'],        // addebito → charge
  ['rimbors', 'refund'],       // rimborso → refund
  ['abbonam', 'subscript'],    // abbonamento → subscription
  ['pian', 'plan'],            // piano → plan
  ['fattur', 'invoic'],        // fattura → invoice
  ['ricevut', 'receipt'],      // ricevuta → receipt
  ['carrell', 'cart'],         // carrello → cart
  ['cestin', 'basket'],        // cestino → basket
  ['prodott', 'product'],      // prodotto → product
  ['articol', 'item'],         // articolo → item
  ['prezz', 'price'],          // prezzo → price
  ['cost', 'cost'],            // costo → cost
  ['import', 'amount'],        // importo → amount
  ['tariff', 'fee'],           // tariffa → fee
  ['scont', 'discount'],       // sconto → discount
  ['promoz', 'promo'],         // promozione → promo
  ['coupon', 'coupon'],
  ['ordin', 'order'],          // ordine → order
  ['spediz', 'ship'],          // spedizione → shipping
  ['consegn', 'deliver'],      // consegna → delivery
  ['indirizz', 'address'],     // indirizzo → address
  ['categor', 'categor'],      // categoria → category
  ['tip', 'type'],             // tipo → type
  ['etichett', 'tag'],         // etichetta → tag
  ['comment', 'comment'],      // commento → comment
  ['not', 'note'],             // nota → note
  ['recens', 'review'],        // recensione → review
  ['valut', 'rate'],           // valutazione → rating
  ['feedback', 'feedback'],
  ['notific', 'notif'],        // notifica → notification
  ['avvis', 'alert'],          // avviso → alert
  ['messagg', 'messag'],       // messaggio → message
  ['email', 'email'],
  ['post', 'mail'],            // posta → mail
  ['telefon', 'phone'],        // telefono → phone
  ['cellul', 'mobil'],         // cellulare → mobile
  ['credit', 'credit'],        // credito, crediti → credit, credits
  ['debit', 'debit'],          // debito → debit
  ['sald', 'balanc'],          // saldo → balance
  ['total', 'total'],          // totale → total

  // === Tecnici / Technical ===
  ['error', 'error'],          // errore → error
  ['problem', 'problem'],      // problema → problem
  ['bug', 'bug'],
  ['eccez', 'except'],         // eccezione → exception
  ['guast', 'failur'],         // guasto → failure
  ['avvertim', 'warn'],        // avvertimento → warning
  ['inform', 'info'],          // informazione → info
  ['configur', 'config'],      // configurazione → config
  ['impost', 'set'],           // impostazioni → settings
  ['opz', 'option'],           // opzioni → options
  ['prefer', 'prefer'],        // preferenze → preferences
  ['cache', 'cach'],
  ['cod', 'queue'],            // coda → queue
  ['lavor', 'job'],            // lavoro → job
  ['event', 'event'],          // evento → event
  ['api', 'api'],
  ['endpoint', 'endpoint'],
  ['percors', 'rout'],         // percorso → route
  ['databas', 'databas'],      // database → database
  ['tabell', 'tabl'],          // tabella → table
  ['collez', 'collect'],       // collezione → collection
  ['colonn', 'column'],        // colonna → column
  ['camp', 'field'],           // campo → field
  ['attribut', 'attribut'],    // attributo → attribute
  ['rig', 'row'],              // riga → row
  ['record', 'record'],
  ['chiav', 'key'],            // chiave → key
  ['valor', 'valu'],           // valore → value
  ['list', 'list'],            // lista → list
  ['elenc', 'array'],          // elenco → array
  ['mapp', 'map'],             // mappa → map
  ['dizionar', 'dictionari'],  // dizionario → dictionary
  ['oggett', 'object'],        // oggetto → object
  ['file', 'file'],
  ['document', 'document'],    // documento → document
  ['cartell', 'folder'],       // cartella → folder
  ['director', 'director'],    // directory → directory
  ['immagin', 'imag'],         // immagine → image
  ['fot', 'photo'],            // foto → photo
  ['video', 'video'],
  ['audio', 'audio'],
  ['test', 'test'],
  ['prov', 'test'],            // prova → test

  // === Stati / Status ===
  ['attiv', 'activ'],          // attivo → active
  ['inattiv', 'inactiv'],      // inattivo → inactive
  ['abilit', 'enabl'],         // abilitato → enabled
  ['disabilit', 'disabl'],     // disabilitato → disabled
  ['pendent', 'pend'],         // pendente → pending
  ['attes', 'wait'],           // in attesa → waiting
  ['cors', 'process'],         // in corso → processing
  ['complet', 'complet'],      // completato → completed
  ['conclus', 'done'],         // concluso → done
  ['finit', 'finish'],         // finito → finished
  ['success', 'success'],      // successo → success
  ['fallit', 'fail'],          // fallito → failed
  ['annull', 'cancell'],       // annullato → cancelled
  ['bozz', 'draft'],           // bozza → draft
  ['pubblic', 'publish'],      // pubblicato → published
  ['archivi', 'archiv'],       // archiviato → archived

  // === UI / Interface ===
  ['pannell', 'panel'],        // pannello → panel
  ['dashboard', 'dashboard'],
  ['pulsant', 'button'],       // pulsante → button
  ['botton', 'button'],        // bottone → button
  ['modul', 'form'],           // modulo → form
  ['selezion', 'select'],      // seleziona → select
  ['menu', 'menu'],
  ['finestr', 'modal'],        // finestra → modal
  ['popup', 'popup'],
  ['pagin', 'page'],           // pagina → page
  ['schermat', 'screen'],      // schermata → screen
  ['vist', 'view'],            // vista → view
  ['component', 'component'],  // componente → component
  ['intestaz', 'header'],      // intestazione → header
  ['pied', 'footer'],          // piede → footer
  ['barr', 'sidebar'],         // barra laterale → sidebar
  ['navig', 'navig'],          // navigazione → navigation
  ['grigl', 'grid'],           // griglia → grid

  // === Moderation ===
  ['segnalaz', 'report'],      // segnalazione → report
  ['sospens', 'suspend'],      // sospensione → suspend
  ['bann', 'ban'],             // bannato → ban
  ['blocc', 'block'],          // bloccato → block
  ['abus', 'abus'],            // abuso → abuse
  ['violaz', 'violat'],        // violazione → violation
  ['spam', 'spam'],

  // === SMS / Verification ===
  ['sms', 'sms'],
  ['otp', 'otp'],
  ['codic', 'code'],           // codice → code
  ['pin', 'pin'],
];
