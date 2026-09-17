@type Author
  @param name String = "Guest" label="Reader name"
  @param avatar Image label="Reader avatar"
@endtype

@type Comment
  @param author Author label="Author"
  @param body Text = "A useful article." label="Comment text" aiInstructions="Write a natural reader comment."
@endtype

@block commentItem(comment: Comment) aiInstructions="Keep the comment concise and consistent with the article."
  <article>
    @if comment.author.avatar
      <img src="{{ comment.author.avatar }}" alt="{{ comment.author.name }}" />
    @endif
    <h3>{{ comment.author.name }}</h3>
    <p>{{ comment.body }}</p>
  </article>
@endblock
