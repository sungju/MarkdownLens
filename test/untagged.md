# Untagged code

A fence with no language, holding shell commands:

```
npm install
cd src && npm run build
```

A fence with no language, holding JSON:

```
{
  "name": "markdown-lens",
  "private": true,
  "version": 1
}
```

An indented block of Python:

    def pair(self, other):
        return (self, other) if not self.dark else (other, self)

    print(pair(1, 2))

A fence with no language, holding plain output that must stay plain:

```
Total: 202 checks passed
All lanes green in 41s
```

A fence tagged with a language highlight.js does not know:

```frobnicate
fn main() {
    let v: Vec<i32> = vec![1, 2];
    println!("{:?}", v);
}
```
