import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {MotionConfig} from 'motion/react';
import {motionTokens} from './motion';
import './styles.css';
import './explorer.css';
import './motion.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user" transition={motionTokens.spring}><App /></MotionConfig></React.StrictMode>);
