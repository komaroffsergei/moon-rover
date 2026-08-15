import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './app/app.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Не найден корневой DOM-элемент приложения.');
}

createRoot(rootElement).render(<App />);
