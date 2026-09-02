declare module 'black-scholes' {
  const bs: {
    blackScholes(
      s: number,
      k: number,
      t: number,
      v: number,
      r: number,
      callPut: 'call' | 'put',
    ): number;
    stdNormalCDF(x: number): number;
  };
  export default bs;
}
