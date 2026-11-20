import json
from pathlib import Path
import pdfplumber
import pypdfium2

folder = Path(json.loads(Path('work/temp/export-check-latest.json').read_text())['folder'])
results = {}
for kind in ('inventory', 'chain', 'offers', 'multipage'):
    file = folder / (kind + '.pdf')
    with pdfplumber.open(file) as document:
        assert document.pages
        for page in document.pages:
            assert page.width > page.height
            assert all(0 <= word['x0'] < word['x1'] <= page.width + 1 and
                       0 <= word['top'] < word['bottom'] <= page.height + 1
                       for word in page.extract_words())
        results[kind] = {'pages': len(document.pages), 'withinPageBounds': True}
        if kind == 'multipage':
            names = []
            for page in document.pages:
                assert 'Paket' in (page.extract_text() or '')
                for table in page.extract_tables():
                    for row in table:
                        if row and row[0] and row[0].startswith('SYNTHETIC'):
                            names.append(row[0].replace('\n', ' '))
            assert names == ['SYNTHETIC MULTIPAGE ROW ' + str(n).zfill(3) for n in range(96)]
            assert len(document.pages) > 1
            results[kind]['all96RowsOnce'] = True
            results[kind]['repeatedTableHeaders'] = True
    rendered = pypdfium2.PdfDocument(str(file))
    rendered[0].render(scale=1.4).to_pil().save(str(folder / (kind + '-page1.png')))
    rendered.close()
(folder / 'pdf-audit.json').write_text(json.dumps({'status': 'PASS', 'checks': results}, indent=2))
print(json.dumps(results))
