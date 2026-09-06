# 📺 Guida Installazione iosonofratv su Smart TV LG webOS

Questa guida ti spiega passo-passo come installare il player **iosonofratv** (`.ipk`) sulla tua Smart TV LG con sistema operativo webOS, utilizzando il comodo tool grafico gratuito per PC **webOS Dev Manager**.

---

## 📦 Il Pacchetto Generato

Il pacchetto pronto per l'installazione si trova in:
```
webos-app/com.iosonofra.tv_1.0.0_all.ipk
```
*(Se desideri ricompilarlo in futuro con modifiche, basta lanciare `node webos-app/build-ipk.js`)*.

---

## 🛠️ Procedura Passo-Passo (5 Minuti)

### 1. Attiva la Modalità Sviluppatore sulla TV LG
1. Accendi la TV LG e apri l'**LG Content Store** (o lo store *Apps*).
2. Nella barra di ricerca scrivi: **Developer Mode**.
3. Seleziona l'app ufficiale **Developer Mode** (sviluppata da LG) e premi **Installa**.
4. Apri l'app **Developer Mode** sulla TV:
   - Se richiesto, accedi con il tuo account LG (puoi registrarti gratuitamente se non ne hai uno).
   - Sposta lo switch **Dev Mode Status** su **ON**.
   - Sposta lo switch **Key Server** su **ON**.
   - La TV mostrerà a schermo:
     - **IP Address**: (es. `192.168.1.150`)
     - **Passphrase**: (un codice di 6 caratteri, es. `A3K9B1`)
   *(Lascia questa schermata aperta sulla TV)*.

---

### 2. Installa webOS Dev Manager sul tuo Computer
1. Scarica sul tuo PC Windows l'installer gratuito di **webOS Dev Manager**:
   - Download: **[webOS Dev Manager Releases (GitHub)](https://github.com/webosbrew/dev-manager/releases)**
   - Scarica il file `webos-dev-manager-setup-...exe`.
2. Avvia il programma installato sul PC.

---

### 3. Collega webOS Dev Manager alla TV
1. Nella schermata iniziale di webOS Dev Manager, clicca su **+ Add Device** (o la chiave inglese in alto a destra).
2. Compila i campi:
   - **Device Name**: `LG TV Salotto` (o a piacere)
   - **IP Address**: Inserisci l'IP mostrato sullo schermo della TV (es. `192.168.1.150`)
   - **Port**: `9922` (predefinita)
   - **Authentication**: Seleziona **Developer Mode**
   - **Passphrase**: Digita il codice a 6 caratteri mostrato sulla TV
3. Clicca su **Add** e poi su **Connect**.
4. In 2 secondi vedrai apparire la lista delle app installate sulla tua TV!

---

### 4. Installa l'App iosonofratv
1. In alto a destra su webOS Dev Manager clicca sul pulsante **Install...** (oppure trascina semplicemente il file con il mouse).
2. Seleziona il file:
   ```
   web-app/webos-app/com.iosonofra.tv_1.0.0_all.ipk
   ```
3. L'installazione impiega meno di 3 secondi.
4. **Fatto!** Sulla TV apparirà la notifica *"Applicazione iosonofratv installata"*, e troverai l'icona nella barra principale della Home di LG webOS!

---

## 🎮 Comandi Telecomando (Magic Remote & Standard)

| Tasto Telecomando | Azione |
| :--- | :--- |
| **Frecce Su / Giù** | Scorrimento canali ed elenco categorie |
| **Frecce Sinistra / Destra** | Passaggio tra colonna Categorie e Canali |
| **OK (Rotella centrale)** | Selezione canale / Mostra OSD info se a schermo intero |
| **BACK (Ritorna)** | Chiude la lista canali e passa a schermo intero; se già a schermo intero, chiude l'app |
| **CH+ / CH- (P+ / P-)** | Zapping rapido istantaneo canale successivo / precedente |
| **Tasti 0 - 9** | Selezione canale diretta per numero (es. digita `1` `0` `5` per andare al canale 105) |
| **Tasto BLU (■)** | Apre le Impostazioni su TV per cambiare indirizzo server streaming |
| **Puntatore Magic Remote** | Puoi anche puntare e cliccare direttamente con il puntatore laser LG |

---

## ⚙️ Impostazioni Server su TV
- L'applicazione si collega di default a:
  `https://alpistream.iosonofra.click`
- Se vuoi collegarla all'IP locale della tua rete domestica (es. `http://192.168.1.50:3000`), ti basta premere il **tasto BLU** sul telecomando all'interno dell'app, digitare l'IP e premere **Salva**. L'indirizzo rimarrà memorizzato nella TV.
