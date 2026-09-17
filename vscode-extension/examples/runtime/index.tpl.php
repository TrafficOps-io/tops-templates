@template "Runtime form" version=1
@validation query fallback="/error"
  @param subid String required
  @param pixel String length=10 required
@endvalidation

@param title String = "Request a callback" label="Page title"
@layout
  <h1>{{title}}</h1>
  <form action="success.php" method="post">
    <input type="hidden" name="subid" value="{query.subid}">
    <label>Name <input name="name" required minlength="4"></label>
    <label>Phone <input name="phone" placeholder="+380 123 456 789" required></label>
    <button type="submit">Submit</button>
  </form>
@endlayout
