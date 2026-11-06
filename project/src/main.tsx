import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, ColorModeScript, extendTheme } from '@chakra-ui/react';
import { inject } from '@vercel/analytics';
import App from './App.tsx';
import './index.css';

inject();

const FONT_STACK = "'SF Mono', 'SFMono-Regular', 'Segoe UI Variable', 'Segoe UI', 'Roboto Flex', Roboto, ui-monospace, 'Cascadia Mono', Menlo, Monaco, Consolas, monospace";

const theme = extendTheme({
  config: { initialColorMode: 'dark', useSystemColorMode: false },
  styles: { global: { body: { bg: '#0a0a0a', color: 'whiteAlpha.900', margin: 0 } } },
  fonts: {
    body: FONT_STACK,
    heading: FONT_STACK,
    mono: FONT_STACK,
  },
  colors: {
    gray: {
      950: '#0a0a0a',
      900: '#111111',
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorModeScript initialColorMode="dark" />
    <ChakraProvider theme={theme}>
      <App />
    </ChakraProvider>
  </StrictMode>
);
