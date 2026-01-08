
from html.parser import HTMLParser

class MyHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in ['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']:
            # Store tag and line number
            self.stack.append((tag, self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag not in ['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']:
            if self.stack:
                last_tag, start_line = self.stack[-1]
                if last_tag == tag:
                    self.stack.pop()
                else:
                    self.errors.append(f"Mismatch: Expected closing for <{last_tag}> (line {start_line}), but found </{tag}> at line {self.getpos()[0]}")
            else:
                self.errors.append(f"Unexpected closing tag </{tag}> at column {self.getpos()[0]}")

    def validate(self, filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        self.feed(content)
        
        if self.stack:
            for tag, line in self.stack:
                self.errors.append(f"Unclosed tag <{tag}> at line {line}")
        
        return self.errors

parser = MyHTMLParser()
errors = parser.validate(r'c:\Users\sharm\Videos\Chatbot-With-Dashboard-main\Chatbot-With-Dashboard-main\public\index.html')

if errors:
    print("Found HTML structural errors:")
    for err in errors[:10]: # Print first 10
        print(err)
else:
    print("HTML structure seems valid (tags balanced).")
