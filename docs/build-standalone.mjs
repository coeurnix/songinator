import { readFile, writeFile } from "node:fs/promises";

const [indexHtml, stylesCss, generatorJs, appJs] = await Promise.all([
  readFile("index-base.html", "utf8"),
  readFile("styles.css", "utf8"),
  readFile("tonal-song-generator.js", "utf8"),
  readFile("app.js", "utf8"),
]);

const body = extractBody(indexHtml);
const generatorBundle = generatorJs
  .replaceAll(/^export function /gm, "function ")
  .replaceAll(/^export class /gm, "class ")
  .replaceAll(/^export const /gm, "const ");

const appBundle = appJs
  .replace(/import \{ generateSong, randomKey \} from "\.\/tonal-song-generator\.js";\n/, "");

const output = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Songinator</title>
    <style>
${stylesCss}
    </style>
  </head>
${body.replace(
  /<script type="module" src="\.\/app\.js"><\/script>/,
  `<script type="module">
${generatorBundle}

${appBundle}
    </script>`,
)}
</html>
`;

await writeFile("index.html", output, "utf8");

function extractBody(html) {
  const match = html.match(/<body>[\s\S]*<\/body>/);
  if (!match) {
    throw new Error("Could not find <body> in index.html");
  }
  return match[0];
}
