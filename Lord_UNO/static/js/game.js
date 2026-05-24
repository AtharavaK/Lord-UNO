/**
 * game.js — UNO Arena Client Engine
 * ─────────────────────────────────────────────
 * • CSS animation triggers (deal, flip, fly, confetti)
 * • Bot AI engine (offline mode, all 3 rulesets)
 * • Full offline game loop (no server needed)
 * • Enhancement hooks on top of game.html's base JS
 *
 * Load AFTER socket.io and AFTER the inline <script> in game.html
 */

'use strict';

/* ═══════════════════════════════════════════════════
   ANIMATION ENGINE
═══════════════════════════════════════════════════ */

const Anim = (() => {

  // ── Card fly to discard pile ─────────────────
  function flyCardToDiscard(cardEl, targetEl, onDone) {
    if (!cardEl || !targetEl) { onDone && onDone(); return; }
    const from   = cardEl.getBoundingClientRect();
    const to     = targetEl.getBoundingClientRect();
    const clone  = cardEl.cloneNode(true);

    clone.style.cssText = `
      position: fixed;
      left: ${from.left}px; top: ${from.top}px;
      width: ${from.width}px; height: ${from.height}px;
      z-index: 900; pointer-events: none;
      transition: all 0.38s cubic-bezier(0.16,1,0.3,1);
      border-radius: 10px;
    `;
    document.body.appendChild(clone);
    cardEl.style.visibility = 'hidden';

    const rotate = Math.random() > 0.5 ? 12 : -12;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.left      = `${to.left + (to.width  - from.width)  / 2}px`;
        clone.style.top       = `${to.top  + (to.height - from.height) / 2}px`;
        clone.style.transform = `rotate(${rotate}deg) scale(0.85)`;
        clone.style.opacity   = '0.7';
      });
    });

    setTimeout(() => {
      clone.remove();
      onDone && onDone();
    }, 420);
  }

  // ── Flip top card ────────────────────────────
  function flipTopCard(onMidpoint) {
    const wrap = document.getElementById('top-card-wrap');
    if (!wrap) return;
    wrap.classList.add('flip-in');
    if (onMidpoint) setTimeout(onMidpoint, 200);
    setTimeout(() => wrap.classList.remove('flip-in'), 600);
  }

  // ── Board flip (UNO Flip card) ───────────────
  function boardFlipAnimation(sideName, onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'board-flip-overlay';
    overlay.innerHTML = `<div class="flip-text">🔄 ${sideName.toUpperCase()} SIDE</div>`;
    document.body.appendChild(overlay);

    const wrap = document.getElementById('top-card-wrap');
    if (wrap) wrap.classList.add('board-flip');

    setTimeout(() => {
      overlay.remove();
      if (wrap) wrap.classList.remove('board-flip');
      onDone && onDone();
    }, 900);
  }

  // ── Deal hand ────────────────────────────────
  function dealHand(containerEl, count, onDone) {
    const cards = containerEl.querySelectorAll('.hand-card');
    cards.forEach((card, i) => {
      card.classList.add('card-dealing');
      card.style.setProperty('--deal-index', i);
    });
    const total = Math.min(count, 14) * 80 + 350 + 100;
    setTimeout(() => {
      cards.forEach(c => c.classList.remove('card-dealing'));
      onDone && onDone();
    }, total);
  }

  // ── New drawn card bounce ────────────────────
  function drawnCardBounce(containerEl) {
    const cards = containerEl.querySelectorAll('.hand-card');
    if (!cards.length) return;
    const last = cards[cards.length - 1];
    last.classList.add('card-drawn-new');
    setTimeout(() => last.classList.remove('card-drawn-new'), 500);
  }

  // ── Confetti burst ───────────────────────────
  function confettiBurst(count = 80) {
    const colors = ['#ff3b3b','#ffd600','#00e676','#2979ff','#f06292','#26c6da','#ff7043','#ab47bc'];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const left     = Math.random() * 100;
      const duration = 1.8 + Math.random() * 1.8;
      const delay    = Math.random() * 0.8;
      const color    = colors[Math.floor(Math.random() * colors.length)];
      const width    = 6 + Math.random() * 10;
      const height   = 8 + Math.random() * 14;

      piece.style.cssText = `
        left: ${left}vw; top: -20px;
        width: ${width}px; height: ${height}px;
        background: ${color};
        animation-duration: ${duration}s;
        animation-delay: ${delay}s;
        transform: rotate(${Math.random() * 360}deg);
      `;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + delay + 0.2) * 1000);
    }
  }

  // ── Turn flash ───────────────────────────────
  function turnFlash() {
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    el.classList.remove('turn-change');
    void el.offsetWidth; // reflow
    el.classList.add('turn-change');
    setTimeout(() => el.classList.remove('turn-change'), 600);
  }

  // ── Deck pulse (your turn, draw available) ───
  function setDeckPulse(active) {
    const deck = document.getElementById('btn-draw');
    if (!deck) return;
    deck.classList.toggle('your-turn-draw', active);
  }

  // ── Direction reverse spin ───────────────────
  function reverseArrowSpin() {
    const el = document.getElementById('direction-arrow');
    if (!el) return;
    el.classList.add('reversing');
    setTimeout(() => el.classList.remove('reversing'), 600);
  }

  // ── UNO badge pop ────────────────────────────
  function unoBadgePop(playerName) {
    // Find badge in player list
    const list = document.getElementById('player-list');
    if (!list) return;
    list.querySelectorAll('.player-name').forEach(el => {
      if (el.textContent.includes(playerName)) {
        const badge = el.closest('.player-item')?.querySelector('.uno-badge');
        if (badge) {
          badge.classList.add('just-called');
          setTimeout(() => badge.classList.remove('just-called'), 600);
        }
      }
    });
  }

  return {
    flyCardToDiscard,
    flipTopCard,
    boardFlipAnimation,
    dealHand,
    drawnCardBounce,
    confettiBurst,
    turnFlash,
    setDeckPulse,
    reverseArrowSpin,
    unoBadgePop,
  };
})();


/* ═══════════════════════════════════════════════════
   HOOK INTO game.html SOCKET EVENTS
   (Adds animations on top of existing handlers)
═══════════════════════════════════════════════════ */

(function hookAnimations() {
  if (typeof socket === 'undefined') return; // not on game page

  const _origHandleGameState = typeof handleGameState !== 'undefined' ? handleGameState : null;
  let _prevTurn = null;
  let _isFirstDeal = true;

  // Patch global handleGameState to inject animations
  window.handleGameState = function(state) {
    const prevState = window.gameState;

    // call original
    if (_origHandleGameState) _origHandleGameState(state);

    // ── Turn change flash ──────────────────────
    if (state.current_turn && state.current_turn !== _prevTurn) {
      Anim.turnFlash();
      _prevTurn = state.current_turn;
    }

    // ── Deck pulse when it's your turn ────────
    const isMyTurn = state.current_turn === window.USERNAME;
    Anim.setDeckPulse(isMyTurn && state.started);

    // ── Direction reversal arrow spin ─────────
    if (prevState && prevState.direction !== state.direction) {
      Anim.reverseArrowSpin();
    }
  };

  // ── game_started: animate deal ────────────────
  socket.on('game_started', () => {
    if (_isFirstDeal) {
      setTimeout(() => {
        const container = document.getElementById('hand-cards');
        if (container) Anim.dealHand(container, window.myHand?.length || 7);
        _isFirstDeal = false;
      }, 80);
    }
  });

  // ── card_played: flip animation ───────────────
  socket.on('card_played', (data) => {
    Anim.flipTopCard();
    if (data.flipped_to) {
      Anim.boardFlipAnimation(data.flipped_to);
    }
  });

  // ── card_drawn: bounce new card ───────────────
  socket.on('card_drawn', () => {
    setTimeout(() => {
      const container = document.getElementById('hand-cards');
      if (container) Anim.drawnCardBounce(container);
    }, 60);
  });

  // ── game_over: confetti ───────────────────────
  socket.on('game_over', (data) => {
    if (data.winner === window.USERNAME) {
      setTimeout(() => Anim.confettiBurst(120), 400);
    } else {
      setTimeout(() => Anim.confettiBurst(40), 400);
    }
  });

  // ── uno_called: badge pop ─────────────────────
  socket.on('uno_called', (data) => {
    Anim.unoBadgePop(data.player);
  });

  // ── Patch playCard to add fly animation ───────
  const _origPlayCard = window.playCard;
  window.playCard = function(cardId) {
    const cardEl    = document.querySelector(`[data-id="${cardId}"]`);
    const targetEl  = document.getElementById('top-card-wrap');

    if (cardEl && targetEl) {
      Anim.flyCardToDiscard(cardEl, targetEl, () => {
        if (_origPlayCard) _origPlayCard(cardId);
      });
    } else {
      if (_origPlayCard) _origPlayCard(cardId);
    }
  };

})();


/* ═══════════════════════════════════════════════════
   BOT AI ENGINE
   Full decision logic for Normal, Flip, No Mercy
═══════════════════════════════════════════════════ */

const BotAI = (() => {

  const LIGHT_COLORS = ['red', 'yellow', 'green', 'blue'];
  const DARK_COLORS  = ['pink', 'teal', 'orange', 'purple'];

  const DRAW_VALUES = new Set([
    'Draw 2', 'Wild Draw 4', 'Draw 5', 'Draw 6', 'Draw 10', 'Wild Draw Color'
  ]);

  const ACTION_PRIORITY = {
    'Wild Draw 4':    10,
    'Draw 10':        10,
    'Wild Roulette':   9,
    'Draw 6':          8,
    'Draw 5':          8,
    'Draw 2':          7,
    'Skip Everyone':   7,
    'Wild':            6,
    'Wild Draw Color': 6,
    'Discard All':     6,
    'Skip':            5,
    'Reverse':         4,
    'Flip':            3,
  };

  // ── Is a card playable given game state ──────
  function isPlayable(card, state) {
    const top  = state.top_card;
    const cur  = state.current_color;
    const side = state.current_side || 'light';

    if (card.side && card.side !== side) return false;
    if (card.color === 'wild') return true;

    // Must stack if pending draw
    if (state.pending_draw > 0) return DRAW_VALUES.has(card.value);

    if (card.color === cur) return true;
    if (top && card.value === top.value) return true;
    return false;
  }

  // ── Pick best color for wild ─────────────────
  function bestColor(hand, side) {
    const colors = side === 'dark' ? DARK_COLORS : LIGHT_COLORS;
    const counts = {};
    colors.forEach(c => counts[c] = 0);
    hand.forEach(card => {
      if (card.color !== 'wild' && colors.includes(card.color)) {
        counts[card.color] = (counts[card.color] || 0) + 1;
      }
    });
    // Return most frequent; tie-break random
    const sorted = colors.sort((a, b) => counts[b] - counts[a]);
    return sorted[0] || colors[Math.floor(Math.random() * colors.length)];
  }

  // ── Strategic card selection ─────────────────
  function chooseCard(hand, state, difficulty) {
    const playable = hand.filter(c => isPlayable(c, state));
    if (!playable.length) return null;

    if (difficulty === 'easy') {
      // Easy: random playable card
      return playable[Math.floor(Math.random() * playable.length)];
    }

    if (difficulty === 'medium') {
      // Medium: prefer action cards, save wilds if possible
      const nonWild = playable.filter(c => c.color !== 'wild');
      const actions = playable.filter(c => ACTION_PRIORITY[c.value]);
      if (actions.length && Math.random() > 0.3) {
        return actions.sort((a, b) => (ACTION_PRIORITY[b.value] || 0) - (ACTION_PRIORITY[a.value] || 0))[0];
      }
      return nonWild.length ? nonWild[Math.floor(Math.random() * nonWild.length)] : playable[0];
    }

    // Hard: full strategy
    return hardStrategy(playable, hand, state);
  }

  function hardStrategy(playable, hand, state) {
    // 1. If opponent(s) have 1-2 cards, use offensive cards first
    const opponents = state.players.filter(p => p.name !== state.current_turn);
    const dangerousOpponent = opponents.some(p => p.card_count <= 2 && !p.eliminated);

    if (dangerousOpponent) {
      // Find highest-impact draw card
      const attack = playable.filter(c => DRAW_VALUES.has(c.value));
      if (attack.length) {
        return attack.sort((a, b) => (ACTION_PRIORITY[b.value] || 0) - (ACTION_PRIORITY[a.value] || 0))[0];
      }
      const skip = playable.filter(c => c.value === 'Skip' || c.value === 'Skip Everyone');
      if (skip.length) return skip[0];
    }

    // 2. If we have 1 card after playing, it's a win — play anything
    if (hand.length === 2) {
      const nonWild = playable.filter(c => c.color !== 'wild');
      if (nonWild.length) return nonWild[0];
    }

    // 3. If pending draw is active, stack if possible
    if (state.pending_draw > 0) {
      const stackers = playable.filter(c => DRAW_VALUES.has(c.value));
      if (stackers.length) {
        return stackers.sort((a, b) => (ACTION_PRIORITY[b.value] || 0) - (ACTION_PRIORITY[a.value] || 0))[0];
      }
    }

    // 4. Prefer matching color over matching value (conserve wilds)
    const colorMatch = playable.filter(c => c.color !== 'wild' && c.color === state.current_color);
    const valueMatch = playable.filter(c => c.color !== 'wild' && state.top_card && c.value === state.top_card.value);
    const wilds      = playable.filter(c => c.color === 'wild');

    // Play number cards first to preserve actions
    if (colorMatch.length) {
      const numbers = colorMatch.filter(c => /^[0-9]$/.test(c.value));
      if (numbers.length) return numbers[Math.floor(Math.random() * numbers.length)];
      return colorMatch[0];
    }
    if (valueMatch.length) return valueMatch[0];

    // 5. Wild: only if no other option
    if (wilds.length) return wilds[0];

    return playable[0];
  }

  // ── Should bot call UNO? ─────────────────────
  function shouldCallUno(hand) {
    return hand.length === 1;
  }

  // ── Should bot challenge UNO? (hard bots) ────
  function shouldChallengeUno(targetPlayer, difficulty) {
    if (difficulty !== 'hard') return false;
    if (targetPlayer.card_count !== 1) return false;
    if (targetPlayer.called_uno) return false;
    return Math.random() > 0.4; // 60% chance to catch
  }

  return {
    isPlayable,
    bestColor,
    chooseCard,
    shouldCallUno,
    shouldChallengeUno,
    DRAW_VALUES,
  };
})();


/* ═══════════════════════════════════════════════════
   OFFLINE GAME ENGINE
   Complete standalone UNO game that runs in the browser.
   Uses BotAI for all non-human players.
   Mirrors game_logic.py behaviour exactly.
═══════════════════════════════════════════════════ */

const OfflineGame = (() => {

  const LIGHT = ['red','yellow','green','blue'];
  const DARK  = ['pink','teal','orange','purple'];
  const MERCY_LIMIT = 25;

  let state = null;
  let onStateChange = null;  // callback(state)
  let onHandUpdate  = null;  // callback(playerIndex, hand)
  let onGameOver    = null;  // callback(winnerName)
  let botTimers     = [];

  // ── Card factory ──────────────────────────────
  function makeCard(color, value, side = 'light') {
    return {
      id:    Math.random().toString(36).slice(2, 10),
      color, value, side,
      label: color === 'wild' ? value : `${color.charAt(0).toUpperCase()+color.slice(1)} ${value}`,
    };
  }

  // ── Deck builders ─────────────────────────────
  function buildNormalDeck() {
    const deck = [];
    LIGHT.forEach(color => {
      deck.push(makeCard(color, '0'));
      ['1','2','3','4','5','6','7','8','9','Skip','Reverse','Draw 2'].forEach(v => {
        deck.push(makeCard(color, v)); deck.push(makeCard(color, v));
      });
    });
    for (let i = 0; i < 4; i++) {
      deck.push(makeCard('wild', 'Wild'));
      deck.push(makeCard('wild', 'Wild Draw 4'));
    }
    return deck;
  }

  function buildFlipDeck() {
    const deck = [];
    LIGHT.forEach(color => {
      deck.push(makeCard(color, '0', 'light'));
      ['1','2','3','4','5','6','7','8','9','Skip','Reverse','Draw 2','Flip'].forEach(v => {
        deck.push(makeCard(color, v, 'light')); deck.push(makeCard(color, v, 'light'));
      });
    });
    for (let i = 0; i < 4; i++) {
      deck.push(makeCard('wild', 'Wild', 'light'));
      deck.push(makeCard('wild', 'Wild Draw 4', 'light'));
    }
    DARK.forEach(color => {
      ['1','2','3','4','5','6','7','8','9','Skip','Reverse','Draw 5','Flip'].forEach(v => {
        deck.push(makeCard(color, v, 'dark')); deck.push(makeCard(color, v, 'dark'));
      });
    });
    for (let i = 0; i < 4; i++) {
      deck.push(makeCard('wild', 'Wild', 'dark'));
      deck.push(makeCard('wild', 'Wild Draw Color', 'dark'));
    }
    return deck;
  }

  function buildNoMercyDeck() {
    const deck = buildNormalDeck();
    LIGHT.forEach(color => {
      deck.push(makeCard(color, 'Draw 6')); deck.push(makeCard(color, 'Draw 6'));
      deck.push(makeCard(color, 'Discard All')); deck.push(makeCard(color, 'Discard All'));
    });
    for (let i = 0; i < 4; i++) {
      deck.push(makeCard('wild', 'Draw 10'));
      deck.push(makeCard('wild', 'Wild Roulette'));
    }
    return deck;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Draw card ─────────────────────────────────
  function drawFromDeck(count = 1) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (!state.deck.length) {
        if (state.discard.length <= 1) break;
        const top = state.discard.pop();
        state.deck = shuffle(state.discard);
        state.discard = [top];
        _log('Deck reshuffled from discard pile.');
      }
      if (state.deck.length) drawn.push(state.deck.pop());
    }
    return drawn;
  }

  // ── Logging ───────────────────────────────────
  function _log(msg) {
    state.log.push(msg);
    if (state.log.length > 200) state.log = state.log.slice(-200);
  }

  // ── Active players ────────────────────────────
  function activePlayers() {
    return state.players.filter(p => !p.eliminated);
  }

  function currentPlayer() {
    const active = activePlayers();
    if (!active.length) return null;
    return active[state.current_turn % active.length];
  }

  function advanceTurn(skip = 0) {
    const n = activePlayers().length;
    if (!n) return;
    const steps = 1 + skip;
    state.current_turn = ((state.current_turn + state.direction * steps) % n + n) % n;
  }

  // ── Validity ──────────────────────────────────
  function isValid(card, playerHand) {
    return BotAI.isPlayable(card, state);
  }

  // ── Apply card effect ─────────────────────────
  function applyEffect(card, player) {
    const { value, color } = card;

    if (value === 'Skip') {
      advanceTurn(1);
      _log(`${player.name} skipped the next player.`);
    }
    else if (value === 'Reverse') {
      state.direction *= -1;
      if (activePlayers().length === 2) advanceTurn(1);
      else advanceTurn();
      _log(`${player.name} reversed direction.`);
    }
    else if (value === 'Draw 2') {
      state.pending_draw += 2;
      advanceTurn();
      resolveDrawIfNeeded();
    }
    else if (value === 'Wild Draw 4') {
      state.pending_draw += 4;
      advanceTurn();
      resolveDrawIfNeeded();
    }
    else if (value === 'Flip') {
      state.current_side = state.current_side === 'light' ? 'dark' : 'light';
      _log(`🔄 Board flipped to ${state.current_side} side!`);
      advanceTurn();
      if (onStateChange) onStateChange({ ...state, event: 'flip', flipped_to: state.current_side });
    }
    else if (value === 'Skip Everyone') {
      const others = activePlayers().length - 1;
      advanceTurn(others);
      _log(`${player.name} skipped everyone!`);
    }
    else if (value === 'Draw 5') {
      state.pending_draw += 5;
      advanceTurn();
      resolveDrawIfNeeded();
    }
    else if (value === 'Wild Draw Color') {
      advanceTurn();
      const next = currentPlayer();
      let drawn = 0;
      while (true) {
        const cards = drawFromDeck(1);
        if (!cards.length) break;
        next.hand.push(...cards);
        drawn++;
        if (cards[0].color === state.current_color) break;
      }
      _log(`${next.name} drew ${drawn} cards (until ${state.current_color}).`);
      advanceTurn();
      if (onHandUpdate) onHandUpdate(state.players.indexOf(next), next.hand);
    }
    else if (value === 'Draw 6') {
      state.pending_draw += 6;
      advanceTurn();
      resolveDrawIfNeeded();
    }
    else if (value === 'Draw 10') {
      state.pending_draw += 10;
      advanceTurn();
      resolveDrawIfNeeded();
    }
    else if (value === 'Discard All') {
      const count = player.hand.length;
      state.discard.push(...player.hand);
      player.hand = [];
      _log(`${player.name} discarded all ${count} cards!`);
      if (!player.hand.length) {
        _endGame(player.name); return;
      }
      advanceTurn();
    }
    else if (value === 'Wild Roulette') {
      const others = activePlayers().filter(p => p !== player);
      if (others.length) {
        const victim = others[Math.floor(Math.random() * others.length)];
        const cards  = drawFromDeck(2);
        victim.hand.push(...cards);
        _checkMercyEliminate(victim);
        _log(`🎲 Roulette! ${victim.name} drew 2 cards.`);
        if (onHandUpdate) onHandUpdate(state.players.indexOf(victim), victim.hand);
      }
      advanceTurn();
    }
    else {
      // Number card
      advanceTurn();
    }
  }

  function resolveDrawIfNeeded() {
    const next = currentPlayer();
    if (!next) return;
    const canStack = next.hand.some(c => BotAI.DRAW_VALUES.has(c.value));
    if (!canStack) {
      const cards = drawFromDeck(state.pending_draw);
      next.hand.push(...cards);
      _log(`${next.name} drew ${cards.length} cards.`);
      _checkMercyEliminate(next);
      state.pending_draw = 0;
      advanceTurn();
      if (onHandUpdate) onHandUpdate(state.players.indexOf(next), next.hand);
    }
  }

  function _checkMercyEliminate(player) {
    if (state.ruleset === 'nomercy' && player.hand.length >= MERCY_LIMIT) {
      player.eliminated = true;
      _log(`💀 ${player.name} eliminated — ${MERCY_LIMIT}+ cards!`);
    }
  }

  // ── Win check ─────────────────────────────────
  function _checkWin(player) {
    if (player.hand.length === 0) {
      _endGame(player.name);
      return true;
    }
    return false;
  }

  function _endGame(winnerName) {
    state.winner = winnerName;
    state.started = false;
    _log(`🏆 ${winnerName} wins!`);
    _notify();
    clearBotTimers();
    if (onGameOver) onGameOver(winnerName);
  }

  // ── Notify listeners ─────────────────────────
  function _notify(extra = {}) {
    if (onStateChange) onStateChange(buildPublicState(extra));
  }

  // ── Public state (mirrors server shape) ───────
  function buildPublicState(extra = {}) {
    const cur = currentPlayer();
    return {
      ruleset:       state.ruleset,
      started:       state.started,
      winner:        state.winner,
      current_turn:  cur ? cur.name : null,
      direction:     state.direction,
      current_color: state.current_color,
      current_side:  state.current_side,
      pending_draw:  state.pending_draw,
      top_card:      state.discard.length ? state.discard[state.discard.length - 1] : null,
      deck_count:    state.deck.length,
      players:       state.players.map(p => ({
        name:        p.name,
        card_count:  p.hand.length,
        eliminated:  p.eliminated,
        called_uno:  p.called_uno,
        is_bot:      p.is_bot,
        difficulty:  p.difficulty || 'medium',
      })),
      log:           state.log.slice(-20),
      ...extra,
    };
  }

  // ── Clear bot timers ──────────────────────────
  function clearBotTimers() {
    botTimers.forEach(t => clearTimeout(t));
    botTimers = [];
  }

  // ── Schedule bot turn ─────────────────────────
  function scheduleBotTurn() {
    if (!state || !state.started || state.winner) return;
    const player = currentPlayer();
    if (!player || !player.is_bot) return;

    const thinkTime = { easy: 1400, medium: 900, hard: 600 }[player.difficulty] || 900;
    const jitter    = Math.random() * 400;

    const t = setTimeout(() => {
      if (!state || !state.started || state.winner) return;
      const cur = currentPlayer();
      if (!cur || !cur.is_bot || cur.name !== player.name) return;
      doBotTurn(cur);
    }, thinkTime + jitter);

    botTimers.push(t);
  }

  function doBotTurn(bot) {
    // Show thinking indicator
    _notify({ bot_thinking: bot.name });

    const card = BotAI.chooseCard(bot.hand, buildPublicState(), bot.difficulty);

    if (!card) {
      // Draw
      const drawn = drawFromDeck(state.pending_draw > 0 ? state.pending_draw : 1);
      state.pending_draw = 0;
      bot.hand.push(...drawn);
      _log(`🤖 ${bot.name} drew ${drawn.length} card(s).`);
      if (onHandUpdate) onHandUpdate(state.players.indexOf(bot), bot.hand);
      advanceTurn();
      _notify();
      maybeNextBot();
      return;
    }

    // Play card
    const idx = bot.hand.indexOf(card);
    if (idx === -1) { advanceTurn(); _notify(); maybeNextBot(); return; }
    bot.hand.splice(idx, 1);
    bot.called_uno = false;
    state.discard.push(card);

    // Set color
    if (card.color === 'wild') {
      state.current_color = BotAI.bestColor(bot.hand, state.current_side || 'light');
    } else {
      state.current_color = card.color;
    }

    _log(`🤖 ${bot.name} played ${card.label}.`);

    // Check win
    if (_checkWin(bot)) return;

    // Call UNO?
    if (BotAI.shouldCallUno(bot.hand)) {
      bot.called_uno = true;
      _log(`🚨 ${bot.name} called UNO!`);
    }

    applyEffect(card, bot);
    if (onHandUpdate) onHandUpdate(state.players.indexOf(bot), bot.hand);
    _notify({ last_played: { player: bot.name, card } });
    maybeNextBot();
  }

  function maybeNextBot() {
    const next = currentPlayer();
    if (next && next.is_bot && state.started && !state.winner) {
      scheduleBotTurn();
    }
  }

  // ── PUBLIC API ────────────────────────────────

  /**
   * Create and start an offline game.
   *
   * @param {Object} opts
   *   ruleset     'normal'|'flip'|'nomercy'
   *   humanName   string
   *   bots        [{name, difficulty:'easy'|'medium'|'hard'}]
   *   onState     function(state) — called on every state change
   *   onHand      function(playerIndex, hand)
   *   onOver      function(winnerName)
   */
  function start(opts) {
    clearBotTimers();

    const {
      ruleset    = 'normal',
      humanName  = 'You',
      bots       = [
        { name: 'Bot Alpha',  difficulty: 'medium' },
        { name: 'Bot Beta',   difficulty: 'hard'   },
      ],
      onState, onHand, onOver,
    } = opts;

    onStateChange = onState || null;
    onHandUpdate  = onHand  || null;
    onGameOver    = onOver  || null;

    // Build deck
    const deckBuilders = {
      normal:   buildNormalDeck,
      flip:     buildFlipDeck,
      nomercy:  buildNoMercyDeck,
    };
    const deck = shuffle((deckBuilders[ruleset] || buildNormalDeck)());

    // Build players (human always first)
    const players = [
      { name: humanName, hand: [], is_bot: false, eliminated: false, called_uno: false },
      ...bots.slice(0, 9).map(b => ({
        name: b.name, hand: [], is_bot: true,
        difficulty: b.difficulty || 'medium',
        eliminated: false, called_uno: false,
      })),
    ];

    state = {
      ruleset,
      deck,
      discard:       [],
      players,
      current_turn:  0,
      direction:     1,
      current_color: null,
      current_side:  'light',
      pending_draw:  0,
      started:       true,
      winner:        null,
      log:           [],
    };

    // Deal 7 cards
    players.forEach(p => {
      const cards = drawFromDeck(7);
      p.hand = cards;
    });

    // First card (number only)
    let first;
    while (true) {
      first = drawFromDeck(1)[0];
      if (first && first.color !== 'wild' && /^[0-9]$/.test(first.value)) break;
      if (first) state.deck.unshift(first);
    }
    state.discard.push(first);
    state.current_color = first.color;

    _log(`Game started! First card: ${first.label}`);

    // Notify initial state + human's hand
    _notify();
    if (onHandUpdate) onHandUpdate(0, players[0].hand);

    // If first player is bot (shouldn't happen but safety)
    maybeNextBot();
  }

  /**
   * Human plays a card.
   * @param {string} cardId
   * @param {string|null} chosenColor  for wild cards
   * @returns {{ ok: boolean, error?: string }}
   */
  function humanPlayCard(cardId, chosenColor = null) {
    if (!state || !state.started || state.winner) return { ok: false, error: 'Game not active.' };
    const cur = currentPlayer();
    if (!cur || cur.is_bot) return { ok: false, error: 'Not your turn.' };

    const card = cur.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, error: 'Card not found.' };
    if (!isValid(card, cur.hand)) return { ok: false, error: 'Invalid move.' };

    cur.hand = cur.hand.filter(c => c.id !== cardId);
    cur.called_uno = false;
    state.discard.push(card);

    if (card.color === 'wild') {
      const colors = state.current_side === 'dark' ? DARK : LIGHT;
      state.current_color = chosenColor && colors.includes(chosenColor)
        ? chosenColor
        : LIGHT[Math.floor(Math.random() * LIGHT.length)];
    } else {
      state.current_color = card.color;
    }

    _log(`You played ${card.label}.`);
    if (_checkWin(cur)) return { ok: true };

    applyEffect(card, cur);
    if (onHandUpdate) onHandUpdate(0, cur.hand);
    _notify({ last_played: { player: cur.name, card } });
    maybeNextBot();
    return { ok: true };
  }

  /**
   * Human draws a card.
   * @returns {{ ok: boolean, drawn: number }}
   */
  function humanDrawCard() {
    if (!state || !state.started || state.winner) return { ok: false };
    const cur = currentPlayer();
    if (!cur || cur.is_bot) return { ok: false, error: 'Not your turn.' };

    const count = state.pending_draw > 0 ? state.pending_draw : 1;
    const cards = drawFromDeck(count);
    state.pending_draw = 0;
    cur.hand.push(...cards);
    _log(`You drew ${cards.length} card(s).`);
    advanceTurn();
    if (onHandUpdate) onHandUpdate(0, cur.hand);
    _notify();
    maybeNextBot();
    return { ok: true, drawn: cards.length };
  }

  /**
   * Human calls UNO.
   */
  function humanCallUno() {
    if (!state) return;
    const human = state.players[0];
    if (human.hand.length === 1) {
      human.called_uno = true;
      _log('🚨 You called UNO!');
      _notify({ event: 'uno_called', player: human.name });
    }
  }

  /**
   * Get current human hand.
   */
  function getHumanHand() {
    if (!state) return [];
    return state.players[0]?.hand || [];
  }

  /**
   * Get current public state.
   */
  function getState() {
    if (!state) return null;
    return buildPublicState();
  }

  /**
   * Check if it's the human's turn.
   */
  function isHumanTurn() {
    if (!state || !state.started) return false;
    const cur = currentPlayer();
    return cur && !cur.is_bot;
  }

  /**
   * Stop the game.
   */
  function stop() {
    clearBotTimers();
    state = null;
  }

  return {
    start,
    humanPlayCard,
    humanDrawCard,
    humanCallUno,
    getHumanHand,
    getState,
    isHumanTurn,
    stop,
  };
})();


/* ═══════════════════════════════════════════════════
   OFFLINE UI BRIDGE
   Wires OfflineGame to the same game.html UI used online.
   Activated when URL contains ?mode=offline
═══════════════════════════════════════════════════ */

(function initOfflineMode() {
  const params = new URLSearchParams(location.search);
  if (params.get('mode') !== 'offline') return;

  // Override socket-based functions with offline equivalents
  // game.html checks typeof socket — we stub it out

  const HUMAN_NAME  = params.get('username') || window.USERNAME || 'You';
  const RULESET     = params.get('ruleset')  || 'normal';
  const BOT_COUNT   = Math.min(Math.max(parseInt(params.get('bots') || '2'), 1), 9);
  const DIFFICULTY  = params.get('difficulty') || 'medium';

  const BOT_NAMES = [
    'Bot Alpha','Bot Beta','Bot Gamma','Bot Delta',
    'Bot Epsilon','Bot Zeta','Bot Eta','Bot Theta','Bot Iota'
  ];

  const bots = Array.from({ length: BOT_COUNT }, (_, i) => ({
    name:       BOT_NAMES[i] || `Bot ${i + 1}`,
    difficulty: DIFFICULTY,
  }));

  // Hide lobby overlay immediately (no server needed)
  const lobbyOv = document.getElementById('lobby-overlay');
  if (lobbyOv) lobbyOv.style.display = 'none';

  // Disable socket chat / start button
  const chatRow = document.querySelector('.chat-input-row');
  if (chatRow) chatRow.style.display = 'none';

  // Start the offline game
  OfflineGame.start({
    ruleset:    RULESET,
    humanName:  HUMAN_NAME,
    bots,
    onState(st) {
      // Patch into game.html's handleGameState
      if (typeof window.handleGameState === 'function') {
        // Adapt state shape to match server shape
        window.handleGameState(st);
      }

      // Bot thinking indicator
      if (st.bot_thinking) {
        const list = document.getElementById('player-list');
        list?.querySelectorAll('.player-name').forEach(el => {
          if (el.textContent.includes(st.bot_thinking)) {
            let ind = el.querySelector('.bot-thinking');
            if (!ind) {
              ind = document.createElement('span');
              ind.className = 'bot-thinking';
              ind.innerHTML = '<span></span><span></span><span></span>';
              el.appendChild(ind);
            }
          } else {
            el.querySelector('.bot-thinking')?.remove();
          }
        });
      }

      // Flip animation
      if (st.event === 'flip' && st.flipped_to) {
        Anim.boardFlipAnimation(st.flipped_to);
      }
    },
    onHand(playerIndex, hand) {
      if (playerIndex === 0) {
        window.myHand = hand;
        if (typeof window.renderHand === 'function') window.renderHand();
        // Deal animation on first receive
        setTimeout(() => {
          const container = document.getElementById('hand-cards');
          if (container && hand.length > 1) Anim.dealHand(container, hand.length);
        }, 50);
      }
    },
    onOver(winner) {
      const ov = document.getElementById('win-overlay');
      const nm = document.getElementById('win-player-name');
      if (ov && nm) {
        nm.textContent = winner;
        ov.classList.add('visible');
        const isHuman = winner === HUMAN_NAME;
        Anim.confettiBurst(isHuman ? 120 : 40);
        // Hide rematch for offline (reload instead)
        const rematch = document.getElementById('btn-rematch');
        if (rematch) {
          rematch.style.display = 'block';
          rematch.textContent   = 'Play Again';
          rematch.onclick = () => location.reload();
        }
      }
    },
  });

  // Override playCard, drawCard, callUno for offline
  window.playCard = function(cardId) {
    if (!OfflineGame.isHumanTurn()) {
      if (typeof showToast === 'function') showToast("It's not your turn!", 'error');
      return;
    }
    const hand = OfflineGame.getHumanHand();
    const card = hand.find(c => c.id === cardId);
    if (!card) return;

    if (card.color === 'wild') {
      window._pendingOfflineCard = cardId;
      document.getElementById('color-picker')?.classList.add('visible');
    } else {
      const result = OfflineGame.humanPlayCard(cardId);
      if (!result.ok && typeof showToast === 'function') {
        showToast(result.error || 'Invalid move!', 'error');
      } else if (result.ok) {
        Anim.flipTopCard();
      }
    }
  };

  window.pickColor = function(color) {
    document.getElementById('color-picker')?.classList.remove('visible');
    const id = window._pendingOfflineCard;
    if (id) {
      window._pendingOfflineCard = null;
      const result = OfflineGame.humanPlayCard(id, color);
      if (result.ok) Anim.flipTopCard();
    }
  };

  window.drawCard = function() {
    if (!OfflineGame.isHumanTurn()) {
      if (typeof showToast === 'function') showToast("It's not your turn!", 'error');
      return;
    }
    const result = OfflineGame.humanDrawCard();
    if (result.ok) {
      setTimeout(() => {
        const container = document.getElementById('hand-cards');
        if (container) Anim.drawnCardBounce(container);
      }, 60);
    }
  };

  window.callUno = function() {
    OfflineGame.humanCallUno();
  };

  window.startGame  = function() {}; // no-op (auto-started)
  window.sendChat   = function() {}; // no-op

})();


/* ═══════════════════════════════════════════════════
   SHINE INJECTION
   Adds .card-shine div to every card rendered in hand
═══════════════════════════════════════════════════ */

(function observeHand() {
  const container = document.getElementById('hand-cards');
  if (!container) return;

  const observer = new MutationObserver(() => {
    container.querySelectorAll('.card-inner').forEach(inner => {
      if (!inner.querySelector('.card-shine')) {
        const shine = document.createElement('div');
        shine.className = 'card-shine';
        inner.appendChild(shine);
      }
    });
  });

  observer.observe(container, { childList: true, subtree: true });
})();
