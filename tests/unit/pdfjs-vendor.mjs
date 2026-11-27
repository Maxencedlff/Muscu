// pdf.js embarqué (vendor/pdfjs/, lecture des PDF de l'import de programme, js/features/plan-pdf.js) : version figée,
// vérifiée octet pour octet. Fichiers d'origine : paquet npm pdfjs-dist@4.10.38, build « legacy » (navigateurs plus
// anciens, dont le WebView d'iOS 16.4), legacy/build/pdf.min.mjs et legacy/build/pdf.worker.min.mjs, renommés en .js.
// Une mise à jour de pdf.js change ces empreintes : la changer ici, dans ARCHITECTURE.md et docs/IMPORT_PROGRAMME.md,
// après avoir relu ses avis de sécurité (https://github.com/mozilla/pdf.js/security/advisories).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PDFJS_VERSION = '4.10.38';
export const PDFJS_SHA256 = {
  'pdf.min.js': '44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72',
  'pdf.worker.min.js': 'bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d',
};

export default function ({ test, assert, ROOT }) {
  const dir = path.join(ROOT, 'vendor/pdfjs');
  test(`pdf.js embarqué : build legacy ${PDFJS_VERSION}, empreintes sha256 figées, licence présente`, () => {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
    assert.deepEqual(files, Object.keys(PDFJS_SHA256).sort(), 'aucun autre script dans vendor/pdfjs/');
    for (const [file, sha] of Object.entries(PDFJS_SHA256)) {
      const buf = fs.readFileSync(path.join(dir, file));
      assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), sha, `${file} : empreinte attendue`);
      const src = buf.toString('utf8');
      assert.match(src.slice(0, 2000), /Copyright 2024 Mozilla Foundation/, `${file} : en-tête de licence de Mozilla`);
      assert.ok(src.includes(`"${PDFJS_VERSION}"`) || src.includes(`'${PDFJS_VERSION}'`), `${file} : version ${PDFJS_VERSION}`);
    }
    assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /Apache License/);
  });
}
