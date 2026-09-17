@template "Formatter semantics" description="Quotes, nesting and embedded languages" version=1
@type Comment
@param name String = "Reader \"one\"" label='Reader name'
@param body Text = "First line\n  Second line\tend" help="Keep  two  spaces and \\ paths." aiInstructions="Keep \"quotes\", {{body}} and  two spaces.\nUse a friendly tone."
@param enabled Boolean = true
@param avatar Image sizes="128x128|256x256"
@param cover Image aspect_ratio="16:9"
@endtype
@section appearance "Appearance"
@param primary Color = "#0f766e"
@param fontSize Range = 18 min=14 max=24 step=1
@param comments Comment[] min_items=1 max_items=3 aiInstructions='Vary the comments.'
@endsection
@block commentItem(comment: Comment) aiInstructions="Explain (briefly), fake: Type."
@if comment.enabled
<article class="comment"><h2>{{ comment.name }}</h2><p>{{comment.body}}</p></article>
@endif
@endblock
@layout
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Formatter semantics</title>
<style>
:root{--primary:{{ primary }};--size:{{fontSize}}px}
.comment{color:var(--primary);font-size:var(--size)}
@media (max-width:600px){.comment{display:block;padding:12px}}
</style>
</head><body>
<main>
@each comment in comments:
@render commentItem(comment)
@endeach
<pre data-preserve="pre">  first
    second

  last  </pre>
<textarea data-preserve="textarea"> first
    second  </textarea>
<p data-preserve="inline"><span>one</span> <span>two</span></p>
<p data-preserve="at-sign">@reader An ordinary text node beginning with an at sign must not become a new standalone DSL directive when HTML wraps this long paragraph.</p>
<div data-preserve="escaped">
@@literal Keep this escaped at sign.
</div>
</main>
<script>
const size={{fontSize}};const values=[1,2,3].map((value)=>({value:value*2}));
const text=`first
  second
    third  `;
const raw=String.raw`\n  \t literal`;
globalThis.formatterResult={size,values,text,raw};
</script>
</body></html>
@endlayout
