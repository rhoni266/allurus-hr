import os
os.chdir('/d/dev/allurus-hr')
with open('js/ops.js', 'r') as f:
    content = f.read()
old = '    return `<div class=\\"card\\">${empty(\'No items yet\', can() ? \'Import your item list from Excel or CSV, or add the first item by hand.\' : \'The store has not been set up yet.\')}\${can() ? \`<div class=\\"actions\\" style=\\"justify-content:center;margin-top:12px\\"><button class=\\"btn btn-primary\\" data-act=\\"ops-import\\">${icon(\'doc\')}Import items</button><button class=\\"btn\\" data-act=\\"ops-item-new\\">${icon(\'plus\')}Add item</button></div>\` : \'\'}</div>\`;'
new = '    return `<div class="card">${empty(\'No items yet\', can() ? \'Import your item list from Excel or CSV, or add the first item by hand.\' : \'The store has not been set up yet.\')}\${can() ? \`<div class="actions" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-act="ops-import">${icon(\'doc\')}Import items</button><button class="btn" data-act="ops-item-new">${icon(\'plus\')}Add item</button></div>\` : \'\'}</div>\`;'
if old in content:
    content = content.replace(old, new)
    with open('js/ops.js', 'w') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('Could not find the exact string')
