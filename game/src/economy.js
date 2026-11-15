// economy.js — the Foundry Yard economy. Every dollar is earned in the open:
// kills, plants, defuses and the round-end payout, with a streak bonus for
// losing rounds in a row. No starting weapon is ever free twice — the Kestrel
// is the only $0 weapon, and it is the one you spawn with.
export function createEconomy() {
  const state = { money: 800, kills: 0, income: 0 };

  function reset() {
    state.money = 800;
    state.kills = 0;
    state.income = 0;
  }

  function roundEnd(won, roundNumber, streak) {
    const payout = won ? 3250 : 1900 + Math.min(streak, 3) * 500;
    state.money += payout;
    state.income += payout;
    return payout;
  }

  function addKill() {
    state.money += 300;
    state.income += 300;
    state.kills++;
  }

  function addPlant() {
    state.money += 300;
    state.income += 300;
  }

  function addDefuse() {
    state.money += 300;
    state.income += 300;
  }

  function spend(amount) {
    if (state.money < amount) return false;
    state.money -= amount;
    return true;
  }

  return { state, reset, roundEnd, addKill, addPlant, addDefuse, spend };
}
