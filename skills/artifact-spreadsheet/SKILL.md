# Spreadsheet Artifact

Use for real spreadsheet deliverables. Clarify ambiguous columns only when the missing choice changes correctness.

1. Preserve source facts and normalize rows into explicit columns.
2. For XLSX, return the structured spreadsheet payload required by the active output contract; never claim a file exists.
3. Use stable sheet names, headers, types, and useful column widths.
4. Verify row counts, formulas, dates, and required fields before finishing.
5. The host or governed Artifact Worker publishes Preview, Download, and version evidence only after workbook reopen validation.
