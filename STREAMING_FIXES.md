# Revisione riproduzione web e webOS

## Correzioni

- **Frammenti DASH 404:** risoluzione XML dei BaseURL gerarchici e dei template ereditati per ogni Representation. Audio e video conservano percorsi distinti, query firmate e richieste Range. Le risorse rimangono disponibili anche durante l'aggiornamento del manifest.
- **Timeline:** conservati timestamp, startNumber, ripetizioni aperte, presentationTimeOffset, durate dei Period e tipo static/dynamic. Il precedente taglio e la conversione forzata potevano generare richieste a frammenti inesistenti. La latenza segue il manifest e il buffer del player.
- **Proxy HLS:** riscrittura di playlist, segmenti, chiavi e tracce alternative anche senza WARP. I parametri degli URL firmati non vengono decodificati due volte.
- **Stream condivisi:** disconnessione rilevata sulla risposta HTTP; ID univoci per processo FFmpeg; chiusura delle vecchie sessioni senza eliminare quelle nuove; nessuna riproduzione di code MPEG-TS iniziate a metà pacchetto PES. Un client con oltre 2 MiB in coda viene disconnesso per limitare la memoria senza bloccare gli altri.
- **Player web:** ogni elemento video possiede una sessione cancellabile, che gestisce anche i fallback. Le risposte dei vecchi canali vengono ignorate. Il recupero dai blocchi è limitato e i motori precedenti vengono distrutti.
- **webOS:** gli errori di rete e le promesse play annullate non attivano il mute da autoplay; rimossi gli handler residui del prompt audio. Ripristinata la gestione originale dei timestamp audio di mpegts.js, rimuovendo il reset della sola traccia audio.
- **FFmpeg:** il muxer MPEG-TS seleziona automaticamente la conversione del bitstream invece di imporre un filtro H.264 anche alle sorgenti HEVC. I processi senza dati da 45 secondi vengono terminati, così il recupero del player può aprire una nuova sessione; gli errori HTTP 4xx non attivano riconnessioni infinite.

## Verifica

`node --test tests/*.test.js`: 48 test superati al momento della pubblicazione. La prova FFmpeg reale è eseguita quando `ffmpeg` è nel PATH (oppure tramite `FFMPEG_BIN`); genera una sorgente DASH locale e verifica la decodifica di audio e video attraverso il proxy. Le prove HTTP verificano risposte ritardate, query firmate e byte range. Le prove dei player simulano cambi canale rapidi, chiusure durante il caricamento, fallback ed errori tardivi.

Queste prove non riproducono la rete WARP del server remoto, le sorgenti protette reali o il decoder hardware LG A1. Non attestano l'assenza assoluta di blocchi su qualsiasi sorgente. Dopo l'aggiornamento verificare un canale WARP e uno ordinario per almeno 30 minuti, inclusi cambi canale ripetuti; eventuali 404 residui sono identificabili tramite sessione nel log.

## Aggiornamento

La nuova dipendenza `@xmldom/xmldom` richiede l'aggiornamento delle dipendenze del backend:

```sh
cd /opt/mandrakodi
git pull --ff-only
npm ci --omit=dev
rc-service mandrakodi restart
```

Ricaricare completamente `/tv` e il player web nel browser. Per la TV installare `webos-app/com.iosonofra.tv_1.0.0_all.ipk` dal medesimo aggiornamento.

## Riferimenti tecnici

- [Node.js HTTP: eventi di chiusura](https://nodejs.org/api/http.html#event-close_2)
- [FFmpeg: conversione automatica H.264 per MPEG-TS](https://ffmpeg.org/ffmpeg-bitstream-filters.html#h264_005fmp4toannexb)
- [xmldom: parsing e serializzazione XML](https://github.com/xmldom/xmldom)
