import json, sys, re
src, out = sys.argv[1], sys.argv[2]
t = open(src).read()
head, rest = t.split('\n\n## Description\n\n', 1)
desc = rest.split('\n\n## Comments (oldest first)\n', 1)[0]
m = re.match(r'# (LIN-\d+): (.*)', head)
labels = re.search(r'^Labels: (.*)$', head, re.M).group(1)
labels = [] if labels == 'none' else [l.strip() for l in labels.split(',')]
json.dump({'identifier': m.group(1), 'title': m.group(2), 'description': desc, 'labels': [{'name': l} for l in labels]}, open(out, 'w'))
