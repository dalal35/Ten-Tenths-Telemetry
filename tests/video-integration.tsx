import {createRoot} from 'react-dom/client';
import App from '../src/App';
import {MotionConfig} from 'motion/react';
import {motionTokens} from '../src/motion';
import '../src/styles.css';
import '../src/explorer.css';
import '../src/motion.css';
createRoot(document.getElementById('root')!).render(<MotionConfig reducedMotion="user" transition={motionTokens.spring}><App/></MotionConfig>);
