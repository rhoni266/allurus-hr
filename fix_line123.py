import os

# Change to the correct directory
os.chdir('/d/dev/allurus-hr')

with open('js/ops.js', 'r') as f:
    lines = f.readlines()

# Fix line 123 (index 122)
line123 = lines[122]
start = line123.index('`', 10)
next_backtick = line123.index('`', start + 1)
third_backtick = line123.index('`', next_backtick + 1)

# The nested template literal content
nested_content = line123[next_backtick + 1:third_backtick]

# Escape backslashes and single quotes in the string
nested_content = nested_content.replace('\\', '\\\\')
nested_content = nested_content.replace("'", "\\'")

# Create a fixed version - use a plain string instead of a template literal
fixed_nested = "'{}'".format(nested_content)
fixed_line = line123[:next_backtick] + fixed_nested + line123[third_backtick + 1:]

lines[122] = fixed_line
with open('js/ops.js', 'w') as f:
    f.writelines(lines)

print('Fixed line 123')
