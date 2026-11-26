# MW 6.4.0: every headline in English, plus the world press on your stocks

## Translation
- Every headline (and a summary once you open it) that isn't English is shown in English: Finnhub, Alpaca, the press
  wires, SEC and the new world-press source. A small **DE→EN / KO→EN** tag marks a translated line; its tooltip and
  the opened line show the original.
- How a line is judged foreign (on this PC, `E.looksEnglish`): another script (CJK, Hangul, Cyrillic, Arabic...) or
  more foreign function words than English ones. Short or unclear lines count as English. A wrong guess only costs one
  translator ask that comes back "en".
- Translators, in order: (1) the on-device Translator + LanguageDetector web APIs when this Edge/WebView2 has them
  (nothing leaves the PC; after 3 failures or 8 s timeouts MW stops trying them for the session); (2) Google
  Translate's keyless web endpoint `translate.googleapis.com/translate_a/single?client=gtx` (free, no account; it is
  the endpoint Google's own translate widget uses, not a documented API, so it can rate-limit: one ask every 1.2 s,
  10 minutes' pause on a 403/429). Only the text is sent, never tickers or holdings.
- Kept on this PC: up to 1,500 translations (store key `tr`). Settings → News → "Show every headline in English".

## World press (GDELT)
- New Live source **INTL**: the GDELT DOC 2.0 API (free, keyless, CORS open, 65 languages machine-translated and
  searchable in English). For each stock you hold or watch, one per turn every 20 s, MW asks for the last day's
  non-English articles that name the company: `"Company Name" -sourcelang:english`, newest 12.
- Company names come from Finnhub's `stock/profile2` (kept 30 days, store `coNames`); funds and ETFs are skipped.
  Names under 4 letters after dropping Inc/Corp/Ltd are not searched (too ambiguous).
- GDELT sees new articles about every 15 minutes, so these lines are minutes to hours old: context, not a squawk.
- Live has a new **World** filter (foreign-press and translated lines).

The page's Content-Security-Policy now allows translate.googleapis.com and api.gdeltproject.org.

## 6.4.1

- News pop-ups and their beep now come only in pre-market and regular hours on trading days: 4:00 AM ET to the close
  (1:00 PM on early-close days). After hours, overnight, weekends and holidays stay quiet. Lines still arrive and are
  highlighted in the list. Engine: `E.newsPingOk`.
