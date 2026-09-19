import { createContext, useContext } from 'react';

// Every consumer supplies the same host ports; storage and transports stay in adapters.
export const StudioHostContext = createContext(null);
export const useStudioHost = () => useContext(StudioHostContext);
