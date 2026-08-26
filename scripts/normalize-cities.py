"""
normalize-cities.py
把 primary_china_city_focus 清洗成标准化的 cities 字段
规则：
- 统一分隔符（逗号/分号/斜杠）→ 逗号
- 去掉"市"/"特别行政区"后缀
- 常见别名标准化（香港特别行政区 → 香港，全国保留）
- 去重、去空
- 不动原始字段，只新增 cities 字段
"""

import csv
import re

# 标准化单个城市名
ALIAS = {
    '香港特别行政区': '香港',
    '澳门特别行政区': '澳门',
    '长三角': '上海',  # 长三角泛指，归上海
}

def normalize_city(raw: str) -> str:
    city = raw.strip()
    if not city:
        return ''
    # 别名替换
    if city in ALIAS:
        return ALIAS[city]
    # 去掉"市"后缀（但保留"全国"、"香港"等特殊值）
    if city.endswith('市') and len(city) > 2:
        city = city[:-1]
    return city

def parse_cities(raw: str) -> list:
    if not raw or not raw.strip():
        return []
    # 统一分隔符：把分号、斜杠换成逗号
    normalized = re.sub(r'[;；/、]', ',', raw)
    parts = [p.strip() for p in normalized.split(',')]
    cities = []
    seen = set()
    for p in parts:
        city = normalize_city(p)
        if city and city not in seen:
            seen.add(city)
            cities.append(city)
    return cities

# ---- 读取 CSV ----
with open('public/company-data-current.csv', 'rb') as f:
    raw = f.read()
content = raw.decode('utf-8')
while content.startswith('﻿'):
    content = content[1:]
rows = list(csv.DictReader(content.splitlines()))

# ---- 处理每行 ----
changed = 0
for row in rows:
    raw_city = row.get('primary_china_city_focus', '')
    cities = parse_cities(raw_city)
    row['cities'] = ','.join(cities)
    if cities:
        changed += 1

# ---- 统计 ----
all_cities = set()
for row in rows:
    for c in row['cities'].split(','):
        if c:
            all_cities.add(c)

print(f'处理完成：{len(rows)} 行')
print(f'有城市数据：{changed} 行')
print(f'无城市数据：{len(rows) - changed} 行')
print(f'不同城市数：{len(all_cities)}')
print(f'城市列表：{sorted(all_cities)}')

# ---- 写回 CSV ----
fieldnames = list(rows[0].keys())
if 'cities' not in fieldnames:
    fieldnames.append('cities')

with open('public/company-data-current.csv', 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print('\n✅ 写入完成：public/company-data-current.csv')
