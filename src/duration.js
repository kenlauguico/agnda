import React from 'react';
import { Select } from 'react-rainbow-components';


const containerStyles = {
    width: 150,
    margin: '1em auto',
};

const options = [
    { value: '1', label: '1 minute' },
    { value: '2', label: '2 minutes' },
    { value: '5', label: '5 minutes' },
    { value: '10', label: '10 minutes' },
    { value: '15', label: '15 minutes' },
    { value: '25', label: '25 minutes' },
    { value: '30', label: '30 minutes' },
    { value: '45', label: '45 minutes' },
    { value: '60', label: '1 hour' },
];


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
      <Select
        value={this.props.value / 60}
        onChange={this.handleChange}
        options={options}
        id="example-select-1"
        style={containerStyles}
        className="rainbow-m-vertical_x-large rainbow-p-horizontal_medium rainbow-m_auto"
      />
    );
  }
}