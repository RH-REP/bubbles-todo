/* android/ は cap add が作る生成物（Git に入れない）なので、要る設定はここで毎回書き足す。
   npm run sync の最後で呼ぶ。

     node tools/patch-android.mjs

   ■ 開発用のローカルサーバーにだけ http で繋げる（2026-10-23）
   Android 9 からは、http（暗号化しない通信）が既定で全部断られる。
   エミュレーターから Mac の server.py へは、`adb reverse tcp:<port> tcp:<port>` を通して
   http://localhost:<port> で繋ぐ。だから localhost と 127.0.0.1 だけ http を許す。
   ・http://10.0.2.2:<port>（エミュレーターから見た Mac）は使えない。アプリのページは https://localhost なので、
     http の住所は「混在コンテンツ」として WebView に止められる（2026-10-23 に確かめた）。
     localhost と 127.0.0.1 は止められない（ループバックは安全な住所として扱われる）
   ・ほかの住所（Tailscale の https://….ts.net など）は今までどおり https だけ。 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main');
const MANIFEST = join(MAIN, 'AndroidManifest.xml');
const NSC = join(MAIN, 'res', 'xml', 'network_security_config.xml');

const NSC_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- tools/patch-android.mjs が書く（手で直さない）。開発用のローカルサーバーにだけ http を許す -->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>
`;

await mkdir(dirname(NSC), { recursive: true });
await writeFile(NSC, NSC_XML);

let xml = await readFile(MANIFEST, 'utf8');
const attr = 'android:networkSecurityConfig="@xml/network_security_config"';
if (!xml.includes(attr)) {
  xml = xml.replace('<application', `<application\n        ${attr}`);
  await writeFile(MANIFEST, xml);
}
console.log('network_security_config:', xml.includes(attr) ? 'AndroidManifest.xml から指している' : '入っていない');
