# Переносит старую таблицу Зары в новую структуру: python3 -I migrate.py old.xlsx new.xlsx
import sys, re, datetime, collections, openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.utils import get_column_letter as L

src = openpyxl.load_workbook(sys.argv[1])
P, B, R = src.worksheets[1], src.worksheets[2], src.worksheets[3]
LANGS = ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN']
ALL6 = ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA']
NAMES = {'казах': 'KK', 'кыргыз': 'KY', 'киргиз': 'KY', 'узбек': 'UZ', 'армян': 'HY', 'таджик': 'TG', 'грузин': 'KA', 'азербайджан': 'AZ', 'англ': 'EN'}
PRODUCTS = ['Магазинка', 'WB Банк', 'WB Клуб', 'WB Такси', 'WB Flot', 'Портал продавца', 'Другое']
TYPES = ['Пуш', 'Баннер', 'Имейл', 'Исследование', 'Инструкция', 'Другое']
BTYPES = ['Лайн', 'Саблайн', 'Плашка', 'CTA-кнопка', 'Дисклеймер', 'ГЗК (радио / тв)', 'Другое']
STATUSES = ['Новый', 'Из архива', 'Проверить', 'У подрядчика', 'Готово', 'Отдан', 'Отменён']

def s(v): return '' if v is None else str(v).strip()
def langs(v):
    t = s(v).lower()
    if not t: return []
    if re.search(r'\bвс[еёи]\b', t): return ALL6
    out = [code for k, code in NAMES.items() if k in t]
    out += [c for c in LANGS if re.search(r'\b' + c.lower() + r'\b', t)]
    return [c for c in LANGS if c in out]
def product(v):
    t = re.sub(r'\s+', ' ', s(v))
    for p in PRODUCTS:
        if t.lower() == p.lower(): return p
    return t
# Строки-образцы («ПРИМЕР ЗАПОЛНЕНИЯ»): вместо перевода там подсказка «Текст на узбекском».
def is_sample(tr):
    return any(re.search(r'^\s*текст\s*(пуша\s*)?на\s*\w+|^\s*текстна', s(x), re.I) for x in tr)

def limit(v):
    m = re.search(r'\d+', s(v).replace('.0', ''))
    return int(m.group()) if m else None

rows = []
# Пуши: строки без даты продолжают запрос над ними (дата, продукт, языки).
last = {}
for r in P.iter_rows(min_row=2, values_only=True):
    ru = s(r[5])
    if not ru or ru.upper().startswith('ПРИМЕР'): continue
    if isinstance(r[0], datetime.datetime): last = {'date': r[0], 'product': r[1], 'langs': r[2]}
    elif not last: continue
    tr = dict(zip(['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ'], [s(x) for x in r[6:13]]))
    if is_sample(tr.values()): continue
    rows.append(dict(date=last['date'], type='Пуш', btype='', product=product(r[1] or last['product']),
                     langs=langs(r[2] or last['langs']), limit=limit(r[4]), ctx=s(r[3]), ru=ru, tr=tr))
for r in B.iter_rows(min_row=2, values_only=True):
    ru = s(r[6])
    if not ru or not isinstance(r[0], datetime.datetime): continue
    tr = dict(zip(['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN'], [s(x) for x in r[7:15]]))
    if is_sample(tr.values()): continue
    rows.append(dict(date=r[0], type='Баннер', btype=s(r[3]), product=product(r[1]), langs=langs(r[2]),
                     limit=limit(r[5]), ctx=s(r[4]), ru=ru, tr=tr))
rows.sort(key=lambda x: (x['date'], x['type']))
cnt = collections.Counter()
for x in rows:
    pre = 'P' if x['type'] == 'Пуш' else 'B'
    cnt[pre] += 1
    x['id'] = '%s-%04d' % (pre, cnt[pre])
    want = x['langs'] or [c for c in LANGS if x['tr'].get(c)]
    x['langs'] = want
    # Старые строки — уже отданы. Если каких-то языков не хватало, пишем это в «Уже переводили?».
    miss = [c for c in want if not x['tr'].get(c)]
    x['status'] = 'Отдан'
    x['note'] = ('⚠️ при переносе не было перевода: ' + ', '.join(miss)) if miss else ''

wb = openpyxl.Workbook()
HEAD = Font(bold=True, color='FFFFFF')
HFILL = PatternFill('solid', fgColor='2E2566')
LFILL = PatternFill('solid', fgColor='4A3A8C')
thin = Border(bottom=Side(style='thin', color='E6E3EF'))
WRAP = Alignment(wrap_text=True, vertical='top')

# --- Запросы ---
ws = wb.active; ws.title = '📥 Запросы'
cols = ['ID', 'Дата', 'Тип', 'Тип баннера', 'Продукт', 'Языки', 'Лимит', 'Дедлайн', 'Ссылка (тред / Figma)',
        'Контекст', 'Текст RU', 'Статус', 'Уже переводили?'] + LANGS
widths = [9, 11, 10, 13, 14, 16, 7, 14, 18, 24, 42, 13, 30] + [30] * len(LANGS)
ws.append(cols)
for i, w in enumerate(widths, 1): ws.column_dimensions[L(i)].width = w
for c in ws[1]:
    c.font = HEAD; c.fill = LFILL if c.value in LANGS else HFILL; c.alignment = Alignment(vertical='center', wrap_text=True)
ws.row_dimensions[1].height = 30
for x in rows:
    ws.append([x['id'], x['date'].date(), x['type'], x['btype'], x['product'], ', '.join(x['langs']), x['limit'], None, '',
               x['ctx'], x['ru'], x['status'], x['note']] + [x['tr'].get(c, '') for c in LANGS])
n = ws.max_row
for row in ws.iter_rows(min_row=2, max_row=n):
    row[1].number_format = 'DD.MM.YYYY'
    row[7].number_format = 'DD.MM.YYYY HH:MM'
    for c in row: c.alignment = WRAP; c.border = thin
ws.freeze_panes = 'B2'
ws.auto_filter.ref = 'A1:%s%d' % (L(len(cols)), n)
big = n + 2000
def dv(col, items, title):
    v = DataValidation(type='list', formula1='"' + ','.join(items) + '"', allow_blank=True, errorStyle='warning',
                       showErrorMessage=True, errorTitle=title, error='Выберите значение из списка')
    ws.add_data_validation(v); v.add('%s2:%s%d' % (col, col, big))
dv('C', TYPES, 'Тип'); dv('D', BTYPES, 'Тип баннера'); dv('E', PRODUCTS, 'Продукт'); dv('L', STATUSES, 'Статус')
STATUS_COLORS = {'Новый': 'FFE7EF', 'Из архива': 'E2F6EC', 'Проверить': 'FFF4DC', 'У подрядчика': 'FFF2D9', 'Готово': 'ECE8FB', 'Отдан': 'EEEEEE', 'Отменён': 'F5F5F5'}
for st, color in STATUS_COLORS.items():
    ws.conditional_formatting.add('L2:L%d' % big, FormulaRule(formula=['$L2="%s"' % st], fill=PatternFill('solid', bgColor=color)))

# --- Архив ---
wa = wb.create_sheet('📚 Архив переводов')
wa.append(['Источник', 'Дата', 'Тип', 'Текст RU'] + LANGS)
for i, w in enumerate([22, 11, 9, 42] + [30] * len(LANGS), 1): wa.column_dimensions[L(i)].width = w
for c in wa[1]: c.font = HEAD; c.fill = LFILL if c.value in LANGS else HFILL
srcname = ''
for r in R.iter_rows(min_row=2, values_only=True):
    if s(r[0]): srcname = s(r[0])
    ru = s(r[1])
    if not ru: continue
    tr = [s(x) for x in r[2:9]]
    if not any(tr) or is_sample(tr): continue
    wa.append([srcname, None, 'Пуш', ru] + tr + [''])
for row in wa.iter_rows(min_row=2):
    for c in row: c.alignment = WRAP
wa.freeze_panes = 'E2'

# --- Статистика ---
st = wb.create_sheet('📊 Статистика')
st['A1'] = 'Статистика появится после настройки: меню «🌍 Переводы» → «Обновить статистику».'
st['A1'].font = Font(bold=True, size=13)

# --- Как заполнять ---
hp = wb.create_sheet('📖 Как заполнять')
hp.column_dimensions['A'].width = 26; hp.column_dimensions['B'].width = 90
help_rows = [
    ('Как заказать перевод', ''),
    ('1. Новая строка', 'Заполните строку внизу листа «📥 Запросы». Один текст = одна строка (заголовок и текст пуша — две строки).'),
    ('Тип', 'Пуш, Баннер, Имейл… — из списка. Для баннера выберите ещё «Тип баннера».'),
    ('Продукт', 'Из списка. Нет нужного — «Другое» и напишите в «Контекст».'),
    ('Языки', 'Через запятую: «казахский, узбекский» или коды «KK, UZ». «все» = KK, KY, UZ, HY, TG, KA.'),
    ('Лимит', 'Сколько символов максимум (для пушей и кнопок).'),
    ('Дедлайн', 'Дата и время, к которому нужен перевод.'),
    ('Ссылка', 'Тред в Band с запросом и/или Figma.'),
    ('Контекст', 'Зачем текст, где показывается, на что обратить внимание.'),
    ('Текст RU', 'Сам текст. ID, дата и статус заполнятся сами.'),
    ('', ''),
    ('Что произойдёт дальше', ''),
    ('Уже переводили?', 'Таблица сама ищет текст в архиве. Отличается только эмодзи — готовые переводы встанут зелёным. Отличаются цифры — встанут жёлтым, переводчик проверит число.'),
    ('Статус', 'Новый → У подрядчика → Готово → Отдан. «Из архива» — перевод взят из архива, заказывать не нужно.'),
    ('Красная ячейка перевода', 'Перевод длиннее лимита.'),
    ('', ''),
    ('Сроки', 'до 300 слов — от 1 дня · 300–1000 слов — 2–3 дня · 1000+ слов — обсуждаем.'),
]
for a, b in help_rows:
    hp.append([a, b])
for row in hp.iter_rows():
    row[0].font = Font(bold=True); row[1].alignment = Alignment(wrap_text=True, vertical='top')
for r in (1, 12): hp.cell(r, 1).font = Font(bold=True, size=13, color='2E2566')

# --- Справочники ---
dc = wb.create_sheet('⚙️ Справочники')
dc.append(['Продукты', 'Тип', 'Тип баннера', 'Статус', 'Язык (код)', 'Как пишут'])
syn = {'KK': 'казахский, KK-CYR', 'KY': 'кыргызский, киргизский', 'UZ': 'узбекский, uz-Latn', 'HY': 'армянский', 'TG': 'таджикский', 'KA': 'грузинский', 'AZ': 'азербайджанский', 'EN': 'английский'}
for i in range(max(len(PRODUCTS), len(TYPES), len(BTYPES), len(STATUSES), len(LANGS))):
    g = lambda lst: lst[i] if i < len(lst) else None
    dc.append([g(PRODUCTS), g(TYPES), g(BTYPES), g(STATUSES), g(LANGS), syn.get(g(LANGS)) if g(LANGS) else None])
for c in dc[1]: c.font = HEAD; c.fill = HFILL
for i in range(1, 7): dc.column_dimensions[L(i)].width = 22

wb.save(sys.argv[2])
print('запросов:', len(rows), dict(cnt), 'архив:', wa.max_row - 1, 'без части языков:', sum(1 for x in rows if x['note']))
