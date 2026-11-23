// Vérifications statiques : syntaxe de chaque script, manifeste et fichiers liés.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.js')) out.push(path);
  }
  return out;
}

for (const file of [...walk('src'), ...walk('tests'), ...walk('scripts')]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`Syntaxe invalide dans ${file}\n${error.stderr?.toString() || error.message}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
} catch (error) {
  problems.push(`manifest.json illisible : ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) problems.push('manifest_version doit valoir 3.');
  const referenced = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((script) => script.js || []),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
  ].filter(Boolean);
  for (const file of referenced) {
    if (!existsSync(file)) problems.push(`Fichier déclaré introuvable : ${file}`);
  }
  for (const size of ['16', '48', '128']) {
    if (!existsSync(`icons/icon${size}.png`)) problems.push(`Icône manquante : icons/icon${size}.png`);
  }
  const studio = readFileSync('src/studio/studio.html', 'utf8');
  for (const match of studio.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const file = join('src/studio', match[1]);
    if (!existsSync(file)) problems.push(`Ressource du studio introuvable : ${match[1]}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n\n'));
  process.exit(1);
}
console.log('✓ syntaxe, manifeste et ressources OK');
