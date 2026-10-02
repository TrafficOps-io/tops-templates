// The app follows its selected theme, which can differ from the device theme.
export default function BrandMark() {
  return <span className="studio-brandmark" aria-hidden="true"><img className="brandmark-light" src="/brandmark-light.svg" alt="" /><img className="brandmark-dark" src="/brandmark-dark.svg" alt="" /></span>;
}
