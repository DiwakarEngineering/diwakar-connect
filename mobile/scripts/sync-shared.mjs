// Copies code shared with the website into the app, so both use one source of truth.
//   npm run sync-shared   (run after changing the website's database types or formatting)
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dirname, "..", "..", "src", "lib");
const app = join(import.meta.dirname, "..", "src", "lib");
for (const file of ["database.types.ts", "format.ts"]) {
  copyFileSync(join(web, file), join(app, file));
  console.log(`copied src/lib/${file}`);
}
