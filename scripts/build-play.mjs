import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
let html = await readFile("dist/index.html", "utf8");
for (const match of [
  ...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g),
]) {
  const js = await readFile(
    resolve("dist", match[1].replace(/^\.\//, "")),
    "utf8",
  );
  html = html.replace(
    match[0],
    () =>
      `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
}
for (const match of [
  ...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g),
]) {
  const css = await readFile(
    resolve("dist", match[1].replace(/^\.\//, "")),
    "utf8",
  );
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
if (/<(?:script|link)\b[^>]*(?:src|href)=/.test(html))
  throw new Error("External dependency remains in PLAY.html");
if (/(?:fetch\(|new Worker\(|url\(\s*["']?https?:)/.test(html))
  throw new Error("Unexpected network resource in offline build");
await writeFile("dist/PLAY.html", html);
await copyFile("dist/PLAY.html", "PLAY.html");
console.log(
  `PLAY.html ready: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB, inline JS/CSS, no external resources.`,
);
