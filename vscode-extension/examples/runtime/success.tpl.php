@template "Runtime success" version=1
@validation body fallback="submit-error"
  @param phone String required mask="+380 ... ... ..."
  @param name String required min=4
@endvalidation

@param thanks String = "Спасибо за заказ, {body.name}!" label="Thank you message"
@layout
  <h1>{{thanks}}</h1>
  <p>Вам поступит звонок в течение 5 минут на номер {body.phone}.</p>
@endlayout
