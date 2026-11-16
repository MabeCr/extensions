Keep your own notes beside the log: a sked list, a band plan, the contest's exchange, whatever you want in front of you while you operate.

## Write it

Open the panel's settings, name its tab, and write in Markdown. Add the panel as many times as you like, each with its own text.

## Make it live

Drop in [Liquid](https://liquidjs.com) tags and the panel fills them in from your operation as you log: `{{ op.qsoCount }}` shows your contact count, `{{ now | date: '%H:%M' }}` the UTC time.
