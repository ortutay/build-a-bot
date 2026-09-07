export interface ISerializable<TConfig> {
  dump(): TConfig;
}
