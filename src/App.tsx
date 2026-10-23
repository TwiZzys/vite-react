import {Header} from '@/components/header/header';
// import {useSvgSprite} from '@/hooks/useSvgSprite';

export default function App() {
  // useSvgSprite(); // інжект спрайту на сторінку якщо потрібно

  return (
    <div className="container">
      <Header/>
    </div>
  );
}
