import { scanSerial } from './compute.mjs';


self.onmessage = ({ data: { id, filtered, width, height, count } }) => {
  const peaks = scanSerial(filtered, width, height, count);
  self.postMessage({ id, peaks });
};


self.postMessage({ ready: true });
