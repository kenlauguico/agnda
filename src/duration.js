import React, { Component } from 'react';

export class Duration extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }
  
  handleChange(e) {
    this.props.onChange(e);
    this.setState({ value: e.target.value });
  }
  
  render() {
    return (
      <select value={this.props.value / 60} onChange={this.handleChange}>
        <option value="5">5 minutes</option>
        <option value="15">15 minutes</option>
        <option value="25">25 minutes</option>
        <option value="30">30 minutes</option>
      </select>
    );
  }
}