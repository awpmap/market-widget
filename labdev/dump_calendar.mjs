// Prints MW Lab's calendar as JSON for check_calendar.py
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../lab/engine.js");
const trading = []; let d = E.CAL_VALID_FROM;
while (d <= E.CAL_VALID_TO) { if (E.isTradingDay(d)) trading.push(d); d = E.addDays(d, 1); }
console.log(JSON.stringify({from:E.CAL_VALID_FROM, to:E.CAL_VALID_TO, trading, early:E.EARLY_CLOSE}));
