"""One-time development patch; never run against a live data store."""
from pathlib import Path
import py_compile

p = Path('national/warehouse.py')
s = p.read_text()
s = s.replace("'syr3':'syr3-date-bound-v2'", "'syr3':'syr3-date-microbial-v3'")
s = s.replace("if family=='syr4' else 'false'", "if family in ('syr3','syr4') else 'false'")
s = s.replace(" # EPA's SYR4 dictionary defines P/A only for TC (3100), EC (3014),", " # EPA's SYR3/SYR4 dictionaries define P/A only for TC (3100), EC (3014),")
s = s.replace(" # and FC (3013). These are qualitative results, never concentrations.", " # and FC (3013). These are qualitative results, never concentrations.\n # SYR3 guide, pages 5 and 11:\n # https://www.epa.gov/sites/default/files/2016-12/documents/user_guide_to_obtaining_and_using_syr3_data.pdf")
a = s.index('def activate(store,receipt):')
b = s.index('def distinct_receipts', a)
s = s[:a] + '''def published_receipt(receipt):
 # Discovery is not ingestion. Only apply to an activated published receipt.
 # Copy metadata rather than mutating a persisted receipt during readback.
 current=receipt.get('schema')==VERSION
 expected=PARSER_PROFILES.get(receipt.get('family'))
 return {**receipt,'count_state':'published' if current else 'retained-raw-only',
         'parser_current':bool(current and expected and receipt.get('parser_profile')==expected)}

def activate(store,receipt):
 for key in ('id','sha256','raw_rows','distinct_source_rows','stored_bytes'):
  if key not in receipt:raise ValueError('Incomplete published archive receipt: '+key)
 # Legacy raw records remain visible, but legacy summaries are not served.
 if receipt.get('schema')==VERSION:
  p=summary_path(receipt['id'],receipt['sha256'])
  store.get(receipt['summary_key'],p,receipt['summary_sha256'])
 active=published_receipt(receipt)
 with LOCK:STATE['sources'][active['id']]=active;STATE['errors'].pop(active['id'],None)
''' + s[b:]
s = s.replace("for key,receipt in s['sources'].items()}", "for key,receipt in ((k,published_receipt(v)) for k,v in s['sources'].items())}")
s = s.replace("receipt.update(archive_key=archive_key,reused_source_objects=reusable)", "receipt.update(archive_key=archive_key,reused_source_objects=reusable)\n  receipt.update(count_state='published',parser_current=True)")
p.write_text(s)
py_compile.compile(str(p), doraise=True)
print('Applied and syntax-checked SYR3 and publication status correction.')
