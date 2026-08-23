import base64, os

SCRATCH = r"C:\Users\johnm\AppData\Local\Temp\claude\E--CLAUDE-claude-code\f599ab5f-5b74-4830-8380-2c5f51ee3a2b\scratchpad"

def read(name, mode='r', encoding='utf-8'):
    path = os.path.join(SCRATCH, name)
    with open(path, mode, encoding=encoding if mode == 'r' else None) as f:
        return f.read()

def read_b64(name):
    with open(os.path.join(SCRATCH, name), 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')

def safe_script(js_text):
    return js_text.replace('</script', '<\\/script')

template = read('template.html')
css = read('dashboard.css')
logo_navy_b64 = read_b64('logo_navy.png')
logo_white_b64 = read_b64('logo_white.png')

data_bundle_json = read('data_bundle_v4.json')
xlsx_lib = read('xlsx.full.min.js')
agg_js = read('agg.js')
importer_js = read('importer.js')
charts_js = read('charts.js')
supabase_js = read('supabase.min.js')
auth_js = read('auth.js')
ui_js = read('ui.js')

html = template
html = html.replace('__CSS__', css)
html = html.replace('__LOGO_NAVY__', logo_navy_b64)
html = html.replace('__LOGO_WHITE__', logo_white_b64)
html = html.replace('__DATA_BUNDLE_JSON__', safe_script(data_bundle_json))
html = html.replace('__XLSX_LIB__', safe_script(xlsx_lib))
html = html.replace('__AGG_JS__', safe_script(agg_js))
html = html.replace('__IMPORTER_JS__', safe_script(importer_js))
html = html.replace('__CHARTS_JS__', safe_script(charts_js))
html = html.replace('__SUPABASE_JS__', safe_script(supabase_js))
html = html.replace('__AUTH_JS__', safe_script(auth_js))
html = html.replace('__UI_JS__', safe_script(ui_js))

out_path = os.path.join(SCRATCH, 'CoreTech_Dashboard_Segovia.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

print('Wrote', out_path, '-', os.path.getsize(out_path) / 1024 / 1024, 'MB')
