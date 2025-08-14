// index.js
// Telegram Mini App: Football Lineups Duel — Realtime rooms (Socket.IO)
// Start locally:
//   npm install
//   PUBLIC_URL=http://localhost:3000 BOT_TOKEN=<your-token> node index.js

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Please set BOT_TOKEN env var');
  process.exit(1);
}
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const WEBAPP_URL = `${PUBLIC_URL}/game`;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'football-lineups-duel-realtime.html')));
app.get('/', (req, res) => res.redirect('/game'));
app.get('/health', (req, res) => res.json({ ok: true }));

// ---- Data & helpers (server-side validation) ----
function stripDiacritics(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s-]/g,'').trim();}
function collapseSpaces(s){return s.replace(/\s+/g,' ').trim();}
function surnameVariants(fullSurname){const base=stripDiacritics(collapseSpaces(fullSurname));const parts=base.split(' ');const last=parts[parts.length-1];return last===base?[base]:[base,last];}
const ALIASES={ oezil:'ozil' };

const MATCHES=[
  { id:'wc1998', teams:['France','Brazil'], starters:["Barthez","Thuram","Desailly","Leboeuf","Lizarazu","Deschamps","Karembeu","Petit","Djorkaeff","Zidane","Guivarc'h","Taffarel","Cafu","Aldair","Junior Baiano","Roberto Carlos","Cesar Sampaio","Dunga","Leonardo","Rivaldo","Ronaldo","Bebeto"] },
  { id:'wc2010', teams:['Netherlands','Spain'], starters:["Stekelenburg","Van der Wiel","Heitinga","Mathijsen","Van Bronckhorst","Van Bommel","De Jong","Sneijder","Robben","Kuyt","Van Persie","Casillas","Ramos","Pique","Puyol","Capdevila","Busquets","Xabi Alonso","Xavi","Pedro","Iniesta","Villa"] },
  { id:'wc2014', teams:['Germany','Argentina'], starters:["Neuer","Lahm","Boateng","Hummels","Howedes","Schweinsteiger","Kroos","Kramer","Ozil","Muller","Klose","Romero","Zabaleta","Garay","Demichelis","Rojo","Biglia","Mascherano","Perez","Lavezzi","Messi","Higuain"] },
  { id:'wc2018', teams:['France','Croatia'], starters:["Lloris","Pavard","Varane","Umtiti","Hernandez","Kante","Pogba","Matuidi","Griezmann","Mbappe","Giroud","Subasic","Vrsaljko","Lovren","Vida","Strinic","Brozovic","Modric","Rakitic","Perisic","Rebic","Mandzukic"] },
  { id:'wc2022', teams:['Argentina','France'], starters:["Martinez","Molina","Romero","Otamendi","Tagliafico","De Paul","Fernandez","Mac Allister","Di Maria","Messi","Alvarez","Lloris","Kounde","Varane","Upamecano","Hernandez","Tchouameni","Rabiot","Griezmann","Dembele","Mbappe","Giroud"] },
  { id:'euro2004', teams:['Portugal','Greece'], starters:["Ricardo","Miguel","Ricardo Carvalho","Jorge Andrade","Nuno Valente","Costinha","Maniche","Deco","Figo","Pauleta","Cristiano Ronaldo","Nikopolidis","Seitaridis","Dellas","Kapsis","Fyssas","Katsouranis","Basinas","Zagorakis","Giannakopoulos","Charisteas","Vryzas"] },
  { id:'euro2021', teams:['Italy','England'], starters:["Donnarumma","Di Lorenzo","Bonucci","Chiellini","Emerson","Jorginho","Verratti","Barella","Chiesa","Insigne","Immobile","Pickford","Walker","Stones","Maguire","Trippier","Phillips","Rice","Shaw","Mount","Sterling","Kane"] },
  { id:'ucl2012', teams:['Bayern','Chelsea'], starters:["Neuer","Lahm","Boateng","Tymoshchuk","Contento","Schweinsteiger","Kroos","Robben","Muller","Ribery","Gomez","Cech","Bosingwa","Cahill","David Luiz","Ashley Cole","Mikel","Lampard","Kalou","Mata","Bertrand","Drogba"] },
  { id:'ucl2005', teams:['Milan','Liverpool'], starters:["Dida","Cafu","Nesta","Stam","Maldini","Gattuso","Pirlo","Seedorf","Kaka","Shevchenko","Crespo","Dudek","Finnan","Carragher","Hyypia","Traore","Riise","Gerrard","Alonso","Garcia","Kewell","Baros"] },
  { id:'ucl2019lva', teams:['Liverpool','Barcelona'], starters:["Alisson","Alexander-Arnold","Matip","Van Dijk","Robertson","Fabinho","Henderson","Milner","Shaqiri","Origi","Mane","Ter Stegen","Sergi Roberto","Pique","Lenglet","Jordi Alba","Rakitic","Busquets","Vidal","Messi","Suarez","Coutinho"] }
];
function buildAnswerSet(starters){ const set=new Set(); const show={}; starters.forEach(s=>{ surnameVariants(s).forEach(v=>{ const k=stripDiacritics(v); set.add(k); show[k]=s; });}); return { set, show }; }
const ANSWERS = Object.fromEntries(MATCHES.map(m=>[m.id, buildAnswerSet(m.starters)]));

// ---- Rooms state ----
const rooms = new Map();
function genCode(){ const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<5;i++) c+=a[Math.floor(Math.random()*a.length)]; return rooms.has(c)?genCode():c; }
function baseState(code){ return { code, matchId: MATCHES[0].id, p1:null, p2:null, p1Strikes:0, p2Strikes:0, p1Correct:[], p2Correct:[], turn:1, started:false }; }
function alreadySaidSet(st){ return new Set([...st.p1Correct, ...st.p2Correct].map(stripDiacritics)); }

io.on('connection', (socket) => {
  socket.on('createRoom', ({name}, cb) => {
    const code = genCode();
    const st = baseState(code);
    st.p1 = { id: socket.id, name: name || 'Player 1' };
    rooms.set(code, st);
    socket.join(code);
    cb && cb({ ok:true, code, state: st });
    io.to(code).emit('state', st);
  });

  socket.on('joinRoom', ({code, name}, cb) => {
    code = (code||'').toUpperCase().trim();
    const st = rooms.get(code);
    if(!st){ cb && cb({ ok:false, error:'Room not found' }); return; }
    if(st.p2){ cb && cb({ ok:false, error:'Room full' }); return; }
    st.p2 = { id: socket.id, name: name || 'Player 2' };
    socket.join(code);
    cb && cb({ ok:true, code, state: st });
    io.to(code).emit('state', st);
  });

  socket.on('changeMatch', ({code, matchId}) => {
    const st = rooms.get(code); if(!st) return;
    if(st.started) return;
    if(!MATCHES.find(m=>m.id===matchId)) return;
    st.matchId = matchId;
    io.to(code).emit('state', st);
  });

  socket.on('startGame', ({code}) => {
    const st = rooms.get(code); if(!st) return;
    if(!(st.p1 && st.p2)) return;
    st.started = true;
    st.p1Strikes=0; st.p2Strikes=0; st.p1Correct=[]; st.p2Correct=[]; st.turn=1; delete st.lastError;
    io.to(code).emit('state', st);
  });

  socket.on('submitGuess', ({code, guess}) => {
    const st = rooms.get(code); if(!st || !st.started) return;
    const isP1 = st.p1 && st.p1.id === socket.id;
    const isP2 = st.p2 && st.p2.id === socket.id;
    if(!isP1 && !isP2) return;
    const expectedTurn = st.turn === 1 ? isP1 : isP2;
    if(!expectedTurn) return;

    const raw = (guess||'').trim();
    if(!raw) return;
    const norm0 = stripDiacritics(raw);
    const norm = ALIASES[norm0] || norm0;

    const ans = ANSWERS[st.matchId];
    const said = alreadySaidSet(st);
    const isNew = !said.has(norm);
    const isCorrect = ans.set.has(norm) && isNew;

    if(isCorrect){
      const disp = ans.show[norm] || raw;
      if(isP1) st.p1Correct.push(disp); else st.p2Correct.push(disp);
      st.turn = st.turn === 1 ? 2 : 1;
      delete st.lastError;
    } else {
      const dup = !isNew && ans.set.has(norm);
      if(isP1) st.p1Strikes = Math.min(3, st.p1Strikes+1); else st.p2Strikes = Math.min(3, st.p2Strikes+1);
      st.turn = st.turn === 1 ? 2 : 1;
      st.lastError = dup ? 'Already said — strike!' : 'Not on the starters list.';
    }

    io.to(code).emit('state', st);
  });

  socket.on('resetGame', ({code}) => {
    const st = rooms.get(code); if(!st) return;
    st.started=false; st.p1Strikes=0; st.p2Strikes=0; st.p1Correct=[]; st.p2Correct=[]; st.turn=1; delete st.lastError;
    io.to(code).emit('state', st);
  });

  socket.on('disconnect', () => {
    for(const [code, st] of rooms){
      let changed=false;
      if(st.p1 && st.p1.id===socket.id){ st.p1=null; changed=true; }
      if(st.p2 && st.p2.id===socket.id){ st.p2=null; changed=true; }
      if(changed){ io.to(code).emit('state', st); }
      if(!st.p1 && !st.p2){ rooms.delete(code); }
    }
  });
});

// Telegram bot setup
const bot = new Telegraf(BOT_TOKEN);
bot.start((ctx)=>ctx.reply('Football Lineups Duel — realtime rooms. Tap Play to open.',{
  reply_markup:{ inline_keyboard:[ [ { text:'▶️ Play now', web_app:{ url: WEBAPP_URL } } ] ] }
}));
bot.command('play', (ctx)=>ctx.reply('Open the game:',{
  reply_markup:{ inline_keyboard:[ [ { text:'▶️ Play now', web_app:{ url: WEBAPP_URL } } ] ] }
}));
bot.telegram.setChatMenuButton({
  menu_button: { type:'web_app', text:'Play Lineups Duel', web_app:{ url: WEBAPP_URL } }
}).catch(()=>{});

bot.launch().then(()=>{
  server.listen(PORT, ()=>{
    console.log('Serving on', PUBLIC_URL);
    console.log('Web App URL:', WEBAPP_URL);
    console.log('Bot launched');
  });
});

process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
