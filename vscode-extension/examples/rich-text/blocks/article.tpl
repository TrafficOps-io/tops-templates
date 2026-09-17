@type Article
  @param title String = "A story" label="Title"
  @param body Wysiwyg = "<p>Write with <strong>formatting</strong> and insert images from the editor toolbar.</p>" label="Article"
  @param notes Markdown = "## Details\n\nWrite **Markdown**, add links and insert images from the toolbar." label="Details"
@endtype

@block articleContent(value: Article)
  <section>
    <h2>{{value.title}}</h2>
    <article>{{&value.body}}</article>
    <aside>{{ & value.notes }}</aside>
  </section>
@endblock
