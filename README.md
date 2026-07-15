# Multi-Level Scenes

Modulo per **Foundry VTT v13** che raggruppa più scene di una cartella in un'unica scena multi-livello (multipiano), con zone scale per salire/scendere e logica del tetto per chi è fuori dall'edificio.

*A Foundry VTT v13 module that merges the scenes of a folder into a single multi-level composite scene, with stairs zones and roof logic. English summary at the bottom.*

## Installazione

In Foundry: **Add-on Modules → Install Module** e incolla questo manifest:

```
https://github.com/LinguardEvergreen/multi-level-scenes/releases/latest/download/module.json
```

## Come funziona

### 1. Prepara le scene dei piani

Metti in una **cartella di scene** tutte le mappe dei piani di un edificio. Il nome di ogni scena deve **terminare con un numero** che indica il piano:

| Nome scena | Piano |
|---|---|
| `Torre 00` | Seminterrato (piano -1) |
| `Torre 01` | Piano terra (i PG partono da qui) |
| `Torre 02` | Piano 1 |
| `Torre 03` | Ultimo piano → **tetto** |

Le mappe devono avere **le stesse dimensioni** ed essere **allineate** (l'edificio nello stesso punto in ogni immagine). Il piano con il numero più alto è il tetto, visto da chi sta fuori dall'edificio.

### 2. Costruisci la scena composita

Nella barra degli strumenti a sinistra trovi il gruppo **Scene Multi-Livello** (icona a livelli 🗇). Clicca sul **martello** e scegli la cartella: il modulo crea una nuova scena con:

- un tile a tutta mappa per ogni piano (l'immagine di sfondo della scena originale);
- muri, luci e tile copiati da ogni scena, etichettati con il piano di appartenenza.

### 3. Disegna le zone

Con la scena composita aperta:

- **Zona scale** (icona scale, rettangolo arancione): trascina un rettangolo dove i PG possono cambiare piano. Alla creazione si apre un dialogo di configurazione con:
  - **Piano della zona**: la zona si attiva solo per i token su quel piano (così puoi mettere scale diverse su piani diversi), oppure "Tutti i piani" per un'unica tromba delle scale;
  - **Direzione**: solo su, solo giù o entrambe.

  Il dialogo **Sali / Scendi / Resta** appare al proprietario appena il token **tocca** la zona (basta una sovrapposizione parziale, non serve il centro), e sempre, anche se è disponibile una sola direzione. Dopo la scelta (incluso "Resta") il dialogo non riappare finché il token non esce del tutto dalla zona e ci rientra; uscire dalla zona non lo fa mai comparire. **Tasto destro** su una zona scale per modificarla o eliminarla.
- **Area edificio** (icona edificio, rettangolo blu): trascina un rettangolo attorno all'edificio. Per i token **fuori** da quest'area l'immagine del **tetto** (l'ultimo piano) viene disegnata sopra l'area edificio, al di sopra di nebbia e visione — pulita, senza tagli. È un effetto puramente visivo: il token resta a terra e continua a interagire col **proprio piano** (porte d'ingresso visibili e cliccabili, muri del piano terra attivi, esterno esplorabile normalmente). I token trascinati in scena fuori dall'edificio partono sempre dal piano terra. Tasto destro per eliminarla.
- Le zone (scale ed edificio) sono visibili **solo al GM**: i giocatori non vedono nessun rettangolo.

### 4. Vista per GM e giocatori

- **Giocatori**: vedono automaticamente il piano del proprio token (o il tetto se sono fuori dall'edificio). Token, muri, luci e pavimenti degli altri piani sono nascosti.
- **GM**: quando controlla o muove un token, la vista segue quel token — piano e logica del tetto compresi (token fuori dall'edificio → vista sul tetto). Le **frecce su/giù** negli strumenti impostano un piano manuale, che viene rilasciato appena si seleziona o muove di nuovo un token. I token fuori dall'edificio restano sempre visibili al GM.
- **Elevazione = piano**: cambiare l'elevazione di un token (anche dal HUD del token) lo sposta sul piano corrispondente, e viceversa il cambio piano aggiorna l'elevazione. Con altezza piano 5: elevazione 0–4 → piano 1, 5–9 → piano 2, negativa → piano 0.

### Impostazioni

- **Altezza piano**: differenza di elevation tra un piano e l'altro (default 5). Il piano terra (01) è a elevation 0, il seminterrato (00) è negativo.
- **Piano iniziale predefinito**: piano assegnato ai token appena trascinati in scena (default 1).

### API

```js
const api = game.modules.get("multi-level-scenes").api;
api.openBuilder();            // apre il builder
api.buildComposite(folder);   // costruisce da un Folder di scene
api.setLevel(2);              // cambia il piano visualizzato (GM)
api.getViewedLevel();         // piano attualmente visualizzato
api.refresh();                // forza il refresh della vista
```

## Note e limiti

- Muri, porte (incluse le icone delle porte), luci e collisioni di movimento valgono **solo sul piano a cui appartengono**: sul piano visualizzato sono attivi solo i muri di quel piano.
- I muri/luci disegnati dal GM sulla scena composita vengono assegnati automaticamente al piano attualmente visualizzato.
- L'**altezza piano** deve essere un valore "tondo" rispetto alle elevazioni usate (default 5): un valore come 4.5 mette i token esattamente sul confine tra due piani e li fa cambiare piano al primo movimento.
- La visibilità tra piani è "un piano alla volta": non c'è (ancora) trasparenza verticale tra buchi nei pavimenti.
- I dati dei piani vivono nei flag della scena composita: le scene originali non vengono toccate.

---

## English summary

Group the scenes of a folder into one composite multi-level scene. Scene names must end with a floor number (`00` basement, `01` ground floor, highest = roof). Use the **hammer** tool to build the composite scene, the **stairs** tool to drag rectangles where tokens may change floor (an up/down/stay dialog is prompted to the owner), and the **building** tool to outline the building: tokens outside it see the roof. Players automatically view their token's floor; the GM switches floors with the arrow tools.

## Licenza

MIT
