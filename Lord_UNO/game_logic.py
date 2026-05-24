"""
game_logic.py — Elite UNO Game Engine
Supports: UNO Standard | UNO Flip | UNO No Mercy

RANKING MODE: Game continues until only 1 player remains.
  - Players who empty their hand get a finishing rank (1st, 2nd, 3rd …)
  - They are "finished" (not eliminated) and sit out the remainder
  - The last player still holding cards is the loser
  - game.finished_players  → ordered list of finishers [1st, 2nd, …]
  - game.loser             → name of the last remaining player
  - game.game_over         → True when only ≤1 active player remains
"""

import random
import uuid
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional


# ─────────────────────────────────────────────
#  Enums & Constants
# ─────────────────────────────────────────────

class Color(str, Enum):
    RED    = "red"
    YELLOW = "yellow"
    GREEN  = "green"
    BLUE   = "blue"
    WILD   = "wild"
    # Flip dark side colors
    PINK   = "pink"
    TEAL   = "teal"
    ORANGE = "orange"
    PURPLE = "purple"

class Value(str, Enum):
    ZERO = "0"; ONE = "1"; TWO = "2"; THREE = "3"; FOUR = "4"
    FIVE = "5"; SIX = "6"; SEVEN = "7"; EIGHT = "8"; NINE = "9"
    SKIP       = "Skip"
    REVERSE    = "Reverse"
    DRAW_TWO   = "Draw 2"
    WILD       = "Wild"
    WILD_DRAW_FOUR = "Wild Draw 4"
    FLIP       = "Flip"
    SKIP_EVERYONE  = "Skip Everyone"
    DRAW_FIVE      = "Draw 5"
    WILD_DRAW_COLOR = "Wild Draw Color"
    DRAW_SIX       = "Draw 6"
    DRAW_TEN       = "Draw 10"
    DISCARD_ALL    = "Discard All"
    ROULETTE       = "Wild Roulette"


LIGHT_COLORS = [Color.RED, Color.YELLOW, Color.GREEN, Color.BLUE]
DARK_COLORS  = [Color.PINK, Color.TEAL, Color.ORANGE, Color.PURPLE]
MERCY_HAND_LIMIT = 25

RANK_MEDALS = {1: "🥇", 2: "🥈", 3: "🥉"}


# ─────────────────────────────────────────────
#  Card
# ─────────────────────────────────────────────

@dataclass
class Card:
    color: Color
    value: Value
    side: str = "light"
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])

    def label(self) -> str:
        if self.color == Color.WILD:
            return self.value.value
        return f"{self.color.value.capitalize()} {self.value.value}"

    def to_dict(self) -> dict:
        return {
            "id":    self.id,
            "color": self.color.value,
            "value": self.value.value,
            "side":  self.side,
            "label": self.label(),
        }

    def can_play_on(self, top: "Card", current_color: Color, side: str) -> bool:
        if self.side != side:
            return False
        if self.color == Color.WILD:
            return True
        if self.color == current_color:
            return True
        if self.value == top.value:
            return True
        return False


# ─────────────────────────────────────────────
#  Player
# ─────────────────────────────────────────────

@dataclass
class Player:
    name: str
    sid: str
    hand: list[Card] = field(default_factory=list)
    eliminated: bool = False   # No Mercy: kicked for 25+ cards
    finished:   bool = False   # emptied their hand, now spectating
    rank:       Optional[int] = None   # 1 = first out, 2 = second, etc.
    called_uno: bool = False

    def hand_count(self) -> int:
        return len(self.hand)

    def is_active(self) -> bool:
        """Still in the game — not finished and not eliminated."""
        return not self.finished and not self.eliminated

    def to_dict(self, reveal_hand: bool = False) -> dict:
        return {
            "name":       self.name,
            "sid":        self.sid,
            "card_count": self.hand_count(),
            "eliminated": self.eliminated,
            "finished":   self.finished,
            "rank":       self.rank,
            "called_uno": self.called_uno,
            "hand":       [c.to_dict() for c in self.hand] if reveal_hand else [],
        }


# ─────────────────────────────────────────────
#  Base Game Engine
# ─────────────────────────────────────────────

class UnoBaseGame:
    RULESET = "normal"

    def __init__(self, max_players: int = 10):
        self.max_players   = max_players
        self.players:  list[Player] = []
        self.deck:     list[Card]   = []
        self.discard:  list[Card]   = []
        self.current_turn  = 0
        self.direction     = 1
        self.current_color: Optional[Color] = None
        self.pending_draw   = 0
        self.started        = False
        self.game_over      = False

        # Ranking
        self.finished_players: list[str] = []   # ordered: [1st, 2nd, 3rd …]
        self.loser: Optional[str] = None         # last player holding cards
        self._next_rank = 1                       # counter for finish order

        self.log: list[str] = []

    # ── Logging ──────────────────────────────
    def _log(self, msg: str):
        self.log.append(msg)
        if len(self.log) > 200:
            self.log = self.log[-200:]

    # ── Deck building ─────────────────────────
    def _card_set(self, color: Color, side: str = "light") -> list[Card]:
        cards = []
        number_values = [
            Value.ZERO, Value.ONE, Value.TWO, Value.THREE, Value.FOUR,
            Value.FIVE, Value.SIX, Value.SEVEN, Value.EIGHT, Value.NINE,
        ]
        action_values = [Value.SKIP, Value.REVERSE, Value.DRAW_TWO]
        cards.append(Card(color, Value.ZERO, side))
        for v in number_values[1:]:
            cards += [Card(color, v, side), Card(color, v, side)]
        for v in action_values:
            cards += [Card(color, v, side), Card(color, v, side)]
        return cards

    def build_deck(self) -> list[Card]:
        deck = []
        for color in LIGHT_COLORS:
            deck += self._card_set(color)
        for _ in range(4):
            deck.append(Card(Color.WILD, Value.WILD))
            deck.append(Card(Color.WILD, Value.WILD_DRAW_FOUR))
        return deck

    def shuffle_deck(self):
        random.shuffle(self.deck)

    def _replenish_deck(self):
        if len(self.discard) <= 1:
            return
        top = self.discard[-1]
        self.deck = self.discard[:-1]
        random.shuffle(self.deck)
        self.discard = [top]
        self._log("Deck reshuffled from discard pile.")

    def draw_card(self) -> Optional[Card]:
        if not self.deck:
            self._replenish_deck()
        if not self.deck:
            return None
        return self.deck.pop()

    # ── Player management ─────────────────────
    def add_player(self, name: str, sid: str) -> bool:
        if self.started:
            return False
        if len(self.players) >= self.max_players:
            return False
        if any(p.name == name for p in self.players):
            return False
        self.players.append(Player(name=name, sid=sid))
        self._log(f"{name} joined the game.")
        return True

    def remove_player(self, sid: str):
        self.players = [p for p in self.players if p.sid != sid]

    def get_player_by_sid(self, sid: str) -> Optional[Player]:
        return next((p for p in self.players if p.sid == sid), None)

    def get_player_by_name(self, name: str) -> Optional[Player]:
        return next((p for p in self.players if p.name == name), None)

    def active_players(self) -> list[Player]:
        """Players who still have cards and haven't been eliminated."""
        return [p for p in self.players if p.is_active()]

    # ── Ranking helpers ───────────────────────
    def _finish_player(self, player: Player) -> dict:
        """
        Called when a player empties their hand.
        Assigns rank, marks as finished, checks if game is over.
        Returns an event dict to be emitted.
        """
        player.finished = True
        player.rank     = self._next_rank
        self._next_rank += 1
        self.finished_players.append(player.name)

        medal = RANK_MEDALS.get(player.rank, f"#{player.rank}")
        self._log(f"{medal} {player.name} finished in place #{player.rank}!")

        event = {
            "player": player.name,
            "rank":   player.rank,
            "medal":  medal,
        }

        # After this player finishes, check remaining active count
        remaining = self.active_players()
        if len(remaining) <= 1:
            self._end_game(remaining)
            event["game_over"] = True

        return event

    def _eliminate_player(self, player: Player) -> dict:
        """
        Called when a player is eliminated (No Mercy: 25+ cards).
        They get a rank from the bottom — loser rank is assigned at end.
        """
        player.eliminated = True
        self._log(f"💀 {player.name} eliminated!")

        remaining = self.active_players()
        if len(remaining) <= 1:
            self._end_game(remaining)
            return {"player": player.name, "game_over": True}

        return {"player": player.name, "game_over": False}

    def _end_game(self, remaining: list[Player]):
        """Finalise the game — assign loser, mark game_over."""
        self.game_over = True
        self.started   = False

        if remaining:
            # The one player left holding cards is the loser
            last = remaining[0]
            last.finished  = True
            last.rank      = self._next_rank
            self.loser     = last.name
            self.finished_players.append(last.name)
            self._log(f"💩 {last.name} is last — game over!")
        else:
            self.loser = None

        self._log("🏁 Game finished! Final rankings: " +
                  " · ".join(
                      f"{RANK_MEDALS.get(i+1,'#'+str(i+1))} {n}"
                      for i, n in enumerate(self.finished_players)
                  ))

    # ── Game start ────────────────────────────
    def start_game(self) -> dict:
        if len(self.players) < 2:
            return {"ok": False, "error": "Need at least 2 players."}
        self.deck = self.build_deck()
        self.shuffle_deck()
        for _ in range(7):
            for p in self.players:
                card = self.draw_card()
                if card:
                    p.hand.append(card)
        while True:
            first = self.draw_card()
            if first and first.color != Color.WILD and first.value in [
                Value.ZERO, Value.ONE, Value.TWO, Value.THREE, Value.FOUR,
                Value.FIVE, Value.SIX, Value.SEVEN, Value.EIGHT, Value.NINE
            ]:
                self.discard.append(first)
                self.current_color = first.color
                break
            elif first:
                self.deck.insert(0, first)
        self.started = True
        self._log(f"Game started! First card: {first.label()}")
        return {"ok": True}

    # ── Turn logic ────────────────────────────
    def current_player(self) -> Optional[Player]:
        active = self.active_players()
        if not active:
            return None
        return active[self.current_turn % len(active)]

    def advance_turn(self, skip: int = 0):
        active = self.active_players()
        n = len(active)
        if n == 0:
            return
        steps = 1 + skip
        self.current_turn = (self.current_turn + self.direction * steps) % n
        if self.current_turn < 0:
            self.current_turn += n

    def top_card(self) -> Optional[Card]:
        return self.discard[-1] if self.discard else None

    # ── Validity ─────────────────────────────
    def is_valid_play(self, player: Player, card: Card) -> bool:
        top = self.top_card()
        if not top:
            return True
        if self.pending_draw > 0:
            return card.value in (Value.DRAW_TWO, Value.WILD_DRAW_FOUR)
        return card.can_play_on(top, self.current_color, card.side)

    # ── Core play_card ────────────────────────
    def play_card(self, sid: str, card_id: str, chosen_color: Optional[str] = None) -> dict:
        if not self.started:
            return {"ok": False, "error": "Game hasn't started yet."}

        player = self.get_player_by_sid(sid)
        if not player:
            return {"ok": False, "error": "Player not found."}

        current = self.current_player()
        if not current or current.sid != sid:
            return {"ok": False, "error": "It's not your turn."}

        card = next((c for c in player.hand if c.id == card_id), None)
        if not card:
            return {"ok": False, "error": "Card not in hand."}

        if not self.is_valid_play(player, card):
            return {"ok": False, "error": "Invalid move."}

        player.hand.remove(card)
        player.called_uno = False
        self.discard.append(card)

        if card.color == Color.WILD:
            if chosen_color and chosen_color in [c.value for c in LIGHT_COLORS]:
                self.current_color = Color(chosen_color)
            else:
                self.current_color = random.choice(LIGHT_COLORS)
        else:
            self.current_color = card.color

        self._log(f"{player.name} played {card.label()}.")

        # ── Check if this player finished ──
        if len(player.hand) == 0:
            finish_event = self._finish_player(player)
            state = self._get_state()
            return {
                "ok":           True,
                "state":        state,
                "finish_event": finish_event,   # rank info
                "game_over":    self.game_over,
            }

        result = self._apply_card_effect(card, player)
        return {"ok": True, "state": self._get_state(), **result}

    def _apply_card_effect(self, card: Card, player: Player) -> dict:
        extra = {}

        if card.value == Value.SKIP:
            self.advance_turn(skip=1)
            self._log(f"Next player skipped.")

        elif card.value == Value.REVERSE:
            self.direction *= -1
            if len(self.active_players()) == 2:
                self.advance_turn(skip=1)
            else:
                self.advance_turn()
            self._log("Direction reversed.")

        elif card.value == Value.DRAW_TWO:
            self.pending_draw += 2
            self.advance_turn()
            next_p = self.current_player()
            if not self._can_stack(next_p):
                drawn = self._force_draw(next_p, self.pending_draw)
                self.pending_draw = 0
                self.advance_turn()
                extra["forced_draw"] = {"player": next_p.name, "count": drawn}
                self._log(f"{next_p.name} drew {drawn} cards.")

        elif card.value == Value.WILD:
            self.advance_turn()
            extra["color_chosen"] = self.current_color.value

        elif card.value == Value.WILD_DRAW_FOUR:
            self.pending_draw += 4
            self.advance_turn()
            next_p = self.current_player()
            if not self._can_stack(next_p):
                drawn = self._force_draw(next_p, self.pending_draw)
                self.pending_draw = 0
                self.advance_turn()
                extra["forced_draw"] = {"player": next_p.name, "count": drawn}
                self._log(f"{next_p.name} drew {drawn} cards.")

        else:
            self.advance_turn()

        return extra

    def _can_stack(self, player: Player) -> bool:
        return any(
            c.value in (Value.DRAW_TWO, Value.WILD_DRAW_FOUR)
            for c in player.hand
        )

    def _force_draw(self, player: Player, count: int) -> int:
        drawn = 0
        for _ in range(count):
            card = self.draw_card()
            if card:
                player.hand.append(card)
                drawn += 1
        return drawn

    # ── Draw action ───────────────────────────
    def draw_from_deck(self, sid: str) -> dict:
        if not self.started:
            return {"ok": False, "error": "Game not started."}
        player  = self.get_player_by_sid(sid)
        current = self.current_player()
        if not player or not current or current.sid != sid:
            return {"ok": False, "error": "Not your turn."}

        if self.pending_draw > 0:
            drawn = self._force_draw(player, self.pending_draw)
            self.pending_draw = 0
            self._log(f"{player.name} drew {drawn} penalty cards.")
        else:
            card = self.draw_card()
            if card:
                player.hand.append(card)
                self._log(f"{player.name} drew a card.")
            drawn = 1

        self.advance_turn()
        return {"ok": True, "drawn": drawn, "state": self._get_state()}

    # ── UNO call ─────────────────────────────
    def call_uno(self, sid: str) -> dict:
        player = self.get_player_by_sid(sid)
        if not player:
            return {"ok": False}
        if player.hand_count() == 1:
            player.called_uno = True
            self._log(f"{player.name} called UNO!")
            return {"ok": True}
        return {"ok": False, "error": "Can only call UNO with 1 card."}

    def challenge_uno(self, challenger_sid: str, target_name: str) -> dict:
        target = self.get_player_by_name(target_name)
        if not target:
            return {"ok": False}
        if target.hand_count() == 1 and not target.called_uno:
            self._force_draw(target, 2)
            self._log(f"{target.name} caught not calling UNO! +2 cards.")
            return {"ok": True, "caught": True}
        return {"ok": True, "caught": False}

    # ── State serialisation ───────────────────
    def _get_state(self) -> dict:
        top     = self.top_card()
        current = self.current_player()
        return {
            "ruleset":          self.RULESET,
            "started":          self.started,
            "game_over":        self.game_over,
            "finished_players": self.finished_players,   # ordered rankings
            "loser":            self.loser,
            "current_turn":     current.name if current else None,
            "direction":        self.direction,
            "current_color":    self.current_color.value if self.current_color else None,
            "pending_draw":     self.pending_draw,
            "top_card":         top.to_dict() if top else None,
            "deck_count":       len(self.deck),
            "players":          [p.to_dict() for p in self.players],
            "log":              self.log[-20:],
        }

    def get_hand(self, sid: str) -> dict:
        player = self.get_player_by_sid(sid)
        if not player:
            return {"ok": False}
        return {
            "ok":   True,
            "hand": [c.to_dict() for c in player.hand],
        }

    def get_state(self) -> dict:
        return self._get_state()


# ─────────────────────────────────────────────
#  UNO Flip Game Engine
# ─────────────────────────────────────────────

class UnoFlipGame(UnoBaseGame):
    RULESET = "flip"

    def __init__(self, max_players: int = 10):
        super().__init__(max_players)
        self.current_side: str = "light"

    def build_deck(self) -> list[Card]:
        deck = []
        light_action = [Value.SKIP, Value.REVERSE, Value.DRAW_TWO, Value.FLIP]
        for color in LIGHT_COLORS:
            deck.append(Card(color, Value.ZERO, "light"))
            for v in [Value.ONE, Value.TWO, Value.THREE, Value.FOUR,
                      Value.FIVE, Value.SIX, Value.SEVEN, Value.EIGHT, Value.NINE]:
                deck += [Card(color, v, "light"), Card(color, v, "light")]
            for v in light_action:
                deck += [Card(color, v, "light"), Card(color, v, "light")]
        for _ in range(4):
            deck.append(Card(Color.WILD, Value.WILD, "light"))
            deck.append(Card(Color.WILD, Value.WILD_DRAW_FOUR, "light"))

        dark_action = [Value.SKIP, Value.REVERSE, Value.DRAW_FIVE, Value.FLIP]
        for color in DARK_COLORS:
            deck.append(Card(color, Value.ONE, "dark"))
            for v in [Value.TWO, Value.THREE, Value.FOUR, Value.FIVE,
                      Value.SIX, Value.SEVEN, Value.EIGHT, Value.NINE]:
                deck += [Card(color, v, "dark"), Card(color, v, "dark")]
            for v in dark_action:
                deck += [Card(color, v, "dark"), Card(color, v, "dark")]
        for _ in range(4):
            deck.append(Card(Color.WILD, Value.WILD, "dark"))
            deck.append(Card(Color.WILD, Value.WILD_DRAW_COLOR, "dark"))

        return deck

    def is_valid_play(self, player: Player, card: Card) -> bool:
        if card.side != self.current_side:
            return False
        return super().is_valid_play(player, card)

    def _apply_card_effect(self, card: Card, player: Player) -> dict:
        extra = {}

        if card.value == Value.FLIP:
            self.current_side = "dark" if self.current_side == "light" else "light"
            self._log(f"🔄 Board flipped to {self.current_side} side!")
            extra["flipped_to"] = self.current_side
            self.advance_turn()

        elif card.value == Value.SKIP_EVERYONE:
            others = len(self.active_players()) - 1
            self.advance_turn(skip=others)
            self._log(f"{player.name} played Skip Everyone — all others skipped!")
            extra["skip_everyone"] = True

        elif card.value == Value.DRAW_FIVE:
            self.pending_draw += 5
            self.advance_turn()
            next_p = self.current_player()
            if not self._can_stack_flip(next_p):
                drawn = self._force_draw(next_p, self.pending_draw)
                self.pending_draw = 0
                self.advance_turn()
                extra["forced_draw"] = {"player": next_p.name, "count": drawn}

        elif card.value == Value.WILD_DRAW_COLOR:
            self.advance_turn()
            next_p = self.current_player()
            drawn  = self._draw_until_color(next_p, self.current_color)
            self.advance_turn()
            extra["forced_draw"] = {"player": next_p.name, "count": drawn}
            self._log(f"{next_p.name} drew {drawn} cards until {self.current_color.value}.")

        else:
            extra = super()._apply_card_effect(card, player)

        return extra

    def _can_stack_flip(self, player: Player) -> bool:
        if self.current_side == "dark":
            return any(c.value in (Value.DRAW_FIVE, Value.WILD_DRAW_COLOR) for c in player.hand)
        return super()._can_stack(player)

    def _draw_until_color(self, player: Player, color: Color) -> int:
        drawn = 0
        while True:
            card = self.draw_card()
            if not card:
                break
            player.hand.append(card)
            drawn += 1
            if card.color == color:
                break
        return drawn

    def _get_state(self) -> dict:
        state = super()._get_state()
        state["current_side"] = self.current_side
        return state


# ─────────────────────────────────────────────
#  UNO No Mercy Game Engine
# ─────────────────────────────────────────────

class UnoNoMercyGame(UnoBaseGame):
    RULESET = "nomercy"

    def build_deck(self) -> list[Card]:
        deck = super().build_deck()
        for color in LIGHT_COLORS:
            deck += [Card(color, Value.DRAW_SIX), Card(color, Value.DRAW_SIX)]
            deck += [Card(color, Value.DISCARD_ALL), Card(color, Value.DISCARD_ALL)]
        for _ in range(4):
            deck.append(Card(Color.WILD, Value.DRAW_TEN))
            deck.append(Card(Color.WILD, Value.ROULETTE))
        return deck

    def _apply_card_effect(self, card: Card, player: Player) -> dict:
        extra = {}

        if card.value == Value.DRAW_SIX:
            self.pending_draw += 6
            self.advance_turn()
            next_p = self.current_player()
            if not self._can_stack_mercy(next_p):
                drawn = self._force_draw(next_p, self.pending_draw)
                self.pending_draw = 0
                ev = self._check_mercy_eliminate(next_p)
                if not ev.get("game_over"):
                    self.advance_turn()
                extra["forced_draw"] = {"player": next_p.name, "count": drawn}
                if ev.get("game_over"):
                    extra["game_over"] = True
                self._log(f"{next_p.name} drew {drawn} cards.")

        elif card.value == Value.DRAW_TEN:
            self.pending_draw += 10
            self.advance_turn()
            next_p = self.current_player()
            if not self._can_stack_mercy(next_p):
                drawn = self._force_draw(next_p, self.pending_draw)
                self.pending_draw = 0
                ev = self._check_mercy_eliminate(next_p)
                if not ev.get("game_over"):
                    self.advance_turn()
                extra["forced_draw"] = {"player": next_p.name, "count": drawn}
                if ev.get("game_over"):
                    extra["game_over"] = True
                self._log(f"{next_p.name} drew {drawn} cards.")

        elif card.value == Value.DISCARD_ALL:
            discarded_count = len(player.hand)
            self.discard.extend(player.hand)
            player.hand.clear()
            self._log(f"{player.name} discarded all {discarded_count} cards!")
            extra["discarded_all"] = discarded_count

            if len(player.hand) == 0:
                finish_event = self._finish_player(player)
                extra["finish_event"] = finish_event
                extra["game_over"]    = self.game_over
                return extra   # don't advance turn — player is done

            self.advance_turn()

        elif card.value == Value.ROULETTE:
            others = [p for p in self.active_players() if p.sid != player.sid]
            if others:
                victim = random.choice(others)
                self._force_draw(victim, 2)
                ev = self._check_mercy_eliminate(victim)
                extra["roulette_victim"] = {"player": victim.name, "count": 2}
                if ev.get("game_over"):
                    extra["game_over"] = True
                self._log(f"🎲 Roulette! {victim.name} drew 2 cards.")
            self.advance_turn()

        else:
            extra = super()._apply_card_effect(card, player)

        return extra

    def _can_stack_mercy(self, player: Player) -> bool:
        stackable = {Value.DRAW_TWO, Value.WILD_DRAW_FOUR, Value.DRAW_SIX, Value.DRAW_TEN}
        return any(c.value in stackable for c in player.hand)

    def _check_mercy_eliminate(self, player: Player) -> dict:
        if player.hand_count() >= MERCY_HAND_LIMIT:
            return self._eliminate_player(player)
        return {"game_over": False}


# ─────────────────────────────────────────────
#  Factory
# ─────────────────────────────────────────────

def create_game(ruleset: str, max_players: int = 10) -> UnoBaseGame:
    games = {
        "normal":   UnoBaseGame,
        "flip":     UnoFlipGame,
        "nomercy":  UnoNoMercyGame,
    }
    cls = games.get(ruleset, UnoBaseGame)
    return cls(max_players=max_players)
