/* 開いたときに1回、サーバーを1つにまとめる（js/oneserver.js の consolidate）。
   app.js の最初の import に置く。store.js・sync.js が開く海と繋ぎ先を読む前に済ませるため（2026-11-16） */
import { consolidate } from './oneserver.js';

try { consolidate(); } catch (e) { /* まとめられなくても、今までどおり開く */ }
