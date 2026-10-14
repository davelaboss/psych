import json
import re
import sys

import openpyxl


def expand_photo_references(value):
    text = str(value or "")
    references = set()
    for start, end in re.findall(r"(\d+)\s*-\s*(\d+)", text):
        references.update(range(int(start), int(end) + 1))
    without_ranges = re.sub(r"\d+\s*-\s*\d+", "", text)
    references.update(int(value) for value in re.findall(r"\d+", without_ranges))
    return sorted(references)


workbook = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
sheet = workbook.active
rows = []
for row_number, values in enumerate(
    sheet.iter_rows(min_row=2, max_col=10, values_only=True), start=2
):
    row = {chr(65 + index): value for index, value in enumerate(values)}
    row["rowNumber"] = row_number
    row["photoReferences"] = expand_photo_references(row["A"])
    rows.append(row)

print(json.dumps({"sheet": sheet.title, "rows": rows}, ensure_ascii=False, default=str))
